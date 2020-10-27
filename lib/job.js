'use strict'

const EventEmitter = require('events')
const puppeteer = require('puppeteer')
const uuid = require('uuid').v4
const vm = require('vm')
const Config = require('./config')
const Logger = require('./logger')
const util = require('./util')

/**
 * Class for scheduling, configuring, and running browser automation job.
 *
 * @extends EventEmitter
 */
class Job extends EventEmitter {
  constructor (config, script) {
    super()

    this.browser = null
    this.config = null
    this.id = uuid()
    this.logger = null
    this.page = null
    this.result = {}
    this.running = false
    this.scheduled = false
    this.stopped = false

    this.setConfig(config)
    this.setScript(script)
  }

  /**
   * Start the job.
   *
   * @return {Promise}
   */
  async start () {
    this.emit('begin')

    const { browser, scheduling, title } = this.config

    this.result = {}
    this.running = true

    const { headless, proxy } = browser
    const args = []

    if (proxy) {
      args.push('--proxy-server=' + proxy)
    }

    this.logger.log(`Started "${title}"`)

    try {
      this.browser = await puppeteer.launch({ headless, args })
    } catch (err) {
      this.logger.log('Failed to launch browser: ' + err.message)
      await this.finish()

      return
    }

    this.page = await this.browser.newPage()

    await this.setUserAgent()

    try {
      await this.setup()
    } catch (err) {
      this.logger.log('setup() failed: ' + err.message)
      this.logger.log('Halting job')
      await this.finish()

      return
    }

    let retries = scheduling.retries
    let timeout

    if (scheduling.timeout) {
      retries = Infinity

      timeout = setTimeout(() => {
        this.stopped = true
        this.logger.log('Timed out')
      }, scheduling.timeout * 1e3)
    }

    let i

    for (i = 0; !this.stopped && i < 1 + retries; i++) {
      try {
        if (await this.action(i)) {
          ++i
          break
        }
      } catch (err) {
        this.stopped || this.logger.log('action() failed: ' + err.message)
      }

      if (!this.stopped && scheduling.retryDelay) {
        await util.sleep(scheduling.retryDelay)
      }

      await this.page.reload()
    }

    clearTimeout(timeout)

    this.logger.log(`Ran action() ${i} times`)

    try {
      await this.finalize()
      this.logger.log('Result: ' + JSON.stringify(this.result))
      this.logger.log('Completed')
    } catch (err) {
      this.logger.log('finalize() failed: ' + err.message)
      this.logger.log('Halting job')
    }

    await this.finish()
  }

  /**
   * Stop the job gracefully (i.e. not immediately).
   */
  stop () {
    this.stopped = true
    this.logger.log('Stopped')
  }

  /**
   * Schedule the job to run at a certain datetime.
   * If you try to manually start the job after calling this method,
   * it will throw an error.
   *
   * @param  {(Date|Object)} when
   */
  schedule (when) {
    const unschedule = util.schedule(this.start.bind(this), when)

    this.unschedule = () => {
      unschedule()
      this.emit('end')
    }

    this.scheduled = true

    this.start = () => {
      throw new Error('Job already scheduled')
    }
  }

  /**
   * Unschedule a job. If it hasn't been scheduled, this will throw an error.
   */
  unschedule () {
    throw new Error('No job scheduled')
  }

  /**
   * Set the job's config object.
   *
   * @param {Object} config
   */
  setConfig (config) {
    config = Config.from(config)

    this.config = config
    this.logger = new Logger(config)

    if (config.scheduling.when) {
      const when = new Date(config.scheduling.when)
      this.schedule(when)
    }
  }

  /**
   * Set the job's script.
   *
   * @param {String} script
   */
  setScript (script) {
    if (typeof script !== 'string') {
      throw new Error('Expected script to be a string')
    }

    const context = {}

    vm.createContext(context)

    try {
      vm.runInContext(script, context)
    } catch {
      throw new Error('Invalid script')
    }

    if (context.setup) {
      if (typeof context.setup !== 'function') {
        throw new Error('Expected setup to be a function')
      }

      this.setup = context.setup.bind(this)
    }

    if (context.action) {
      if (typeof context.action !== 'function') {
        throw new Error('Expected action to be a function')
      }

      this.action = context.action.bind(this)
    }

    if (context.finalize) {
      if (typeof context.finalize !== 'function') {
        throw new Error('Expected finalize to be a function')
      }

      this.finalize = context.finalize.bind(this)
    }
  }

  /**
   * Set user-agent specified in config (or random user-agent).
   *
   * @return {Promise}
   */
  setUserAgent () {
    const userAgent = this.config.browser.userAgent || util.randUserAgent()

    return this.page.setUserAgent(userAgent)
  }

  /**
   * Sleep for the specified number of milliseconds.
   *
   * @param  {Number} ms
   *
   * @return {Promise}
   */
  sleep (ms) {
    return util.sleep(ms)
  }

  /**
   * Return an object representation of the job's state/config.
   *
   * @return {Object}
   */
  toObject () {
    return {
      config: this.config,
      id: this.id,
      running: this.running,
      scheduled: this.scheduled
    }
  }

  /**
   * @param  {Number} [timeout = 60000]
   *
   * @return {Promise}
   */
  async recvInbound (timeout = 60e3) {
    const [sms] = await Promise.race([
      EventEmitter.once(this, 'inbound'),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error()), timeout)
      })
    ])

    return sms
  }

  /**
   * @param  {Object} [opts]
   * @param  {Number} [opts.length = 6]
   * @param  {Object} [opts.timeout]
   *
   * @return {Promise}
   */
  async recvCode ({ length = 6, timeout } = {}) {
    const { text } = await this.recvInbound(timeout)
    const regex = new RegExp(`\\d{${length}}`)
    const [code] = text.match(regex) || []

    if (!code) {
      throw new Error('Couldn\'t find code')
    }

    return code
  }

  async setup () {}

  async action () {
    return true
  }

  async finalize () {}

  async finish () {
    this.browser && await this.browser.close()

    this.running = false

    this.logger.end()
    this.emit('end')
  }
}

module.exports = Job
