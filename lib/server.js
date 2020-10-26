'use strict'

const { once } = require('events')
const https = require('https')
const uuid = require('uuid')
const WebSocket = require('ws')
const Manager = require('./manager')

const readBody = async req => {
  let body = ''

  req.on('data', chunk => {
    body += chunk
  })

  await once(req, 'end')

  return body
}

const respond = (resp, { code = 200, body = '', headers = {} } = {}) => {
  resp.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/plain',
    ...headers
  })

  resp.end(body)
}

/**
 * HTTPS/WebSocket server that exposes API for job management.
 *
 * @extends {Manager}
 */
class Server extends Manager {
  constructor (opts) {
    super()

    this.conns = new Set()

    const server = this.http = https.createServer(opts)
    this.ws = new WebSocket.Server({ server })

    this.http
      .on('error', console.error)
      .on('request', async (req, resp) => {
        try {
          await this.handleRequest(req, resp)
        } catch (err) {
          respond(resp, { code: 500, body: 'Internal Server Error' })
          console.error(err)
        }
      })

    this.ws
      .on('connection', this.handleConnection.bind(this))
      .on('error', console.error)
  }

  /**
   * Start the HTTPS/WebSocket server.
   *
   * @param  {...*} args
   *
   * @return {Promise}
   */
  start (...args) {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject)

      try {
        this.http.listen(...args, resolve)
      } catch (err) {
        reject(err)
      }
    })
  }

  /**
   * Stop the servers and currently running jobs.
   */
  stop () {
    super.stop()
    this.http.close()
  }

  handleConnection (conn) {
    this.conns.add(conn)

    conn
      .on('error', console.error)
      .once('close', () => this.conns.delete(conn))
  }

  async handleRequest (req, resp) {
    if (req.url === '/jobs') {
      await this.handleJobsRequest(req, resp)
      return
    }

    if (req.url.startsWith('/jobs/')) {
      this.handleJobRequest(req, resp)
      return
    }

    respond(resp, { code: 404, body: 'Not Found' })
  }

  async handleJobRequest (req, resp) {
    const [, rest] = req.url.split('/jobs/')
    const [id, action] = rest.split('/').filter(Boolean)

    if (!uuid.validate(id)) {
      respond(resp, { code: 400, body: 'Invalid job id' })
      return
    }

    const job = this.getJob(id)

    if (!job) {
      respond(resp, { code: 404, body: 'Job not found' })
      return
    }

    switch (req.method) {
      case 'GET':
        this.handleGetJobRequest(req, resp, job)
        return

      case 'POST':
        switch (action) {
          case 'start':
            this.handleStartJobRequest(req, resp, job)
            return

          case 'stop':
            this.handleStopJobRequest(req, resp, job)
            return

          case 'edit':
            await this.handleEditJobRequest(req, resp, job)
            return

          default:
            respond(resp, { code: 404, body: 'Not Found' })
            return
        }

      default:
        respond(resp, { code: 405, body: 'Method Not Allowed' })
    }
  }

  async handleEditJobRequest (req, resp, job) {
    let body = await readBody(req)

    try {
      body = JSON.parse(body)
    } catch (err) {
      respond(resp, { code: 400, body: 'Invalid Request' })
      console.error(err)
      return
    }

    try {
      body.config && job.setConfig(body.config)
      body.script && job.setScript(body.script)
    } catch (err) {
      respond(resp, { code: 400, body: 'Invalid Request' })
      console.error(err)
      return
    }

    respond(resp)
  }

  handleGetJobRequest (req, resp, job) {
    const obj = job.toObject()
    const body = JSON.stringify(obj)

    respond(resp, { body, headers: { 'Content-Type': 'application/json' } })
  }

  handleStartJobRequest (req, resp, job) {
    if (job.scheduled) {
      respond(resp, { code: 400, body: 'Cannot start job that\'s scheduled' })
      return
    }

    job.start()

    respond(resp, { body: 'Started job ' + job })
  }

  handleStopJobRequest (req, resp, job) {
    if (job.scheduled) {
      job.unschedule()
    } else if (job.running) {
      job.stop()
    } else {
      job.emit('end')
    }

    respond(resp)
  }

  async handleJobsRequest (req, resp) {
    switch (req.method) {
      case 'GET':
        this.handleGetJobsRequest(req, resp)
        return

      case 'POST':
        await this.handlePostJobsRequest(req, resp)
        return

      default:
        respond(resp, { code: 405, body: 'Method Not Allowed' })
    }
  }

  send (msg) {
    this.conns.forEach(conn => conn.send(msg))
  }

  async handlePostJobsRequest (req, resp) {
    let body = await readBody(req)

    try {
      body = JSON.parse(body)
    } catch {
      respond(resp, { code: 400, body: 'Invalid JSON body' })
      return
    }

    try {
      const instances = Math.max(Math.round(+body.instances) || 0, 1)

      for (let i = 1; i <= instances; i++) {
        const config = { ...body.config, title: body.config.title + '-' + i }
        const job = this.addJob(config, body.script)
        const begin = JSON.stringify({ type: 'begin', id: job.id })
        const end = JSON.stringify({ type: 'end', id: job.id })

        job
          .once('begin', () => this.send(begin))
          .once('end', () => this.send(end))
      }

      respond(resp)
    } catch (err) {
      console.error(err)
      respond(resp, { code: 400, body: 'Invalid Request' })
    }
  }

  handleGetJobsRequest (req, resp) {
    const jobs = this.getJobs()
    const objs = jobs.map(job => job.toObject())
    const body = JSON.stringify(objs)

    respond(resp, {
      body,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

module.exports = Server
