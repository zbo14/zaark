'use strict'

const EventEmitter = require('events')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const uuid = require('uuid').v4
const vm = require('vm')
const Config = require('./config')
const util = require('./util')

puppeteer.use(StealthPlugin())

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
    this.logs = []
    this.page = null
    this.result = {}
    this.script = ''
    this.state = 'created'

    this.setConfig(config)
    this.setScript(script)

    const handleBegin = state => {
      if (state === 'running') {
        this.handleBegin()
        this.removeListener('state', handleBegin)
      }
    }

    this.on('state', handleBegin)
  }

  get created () {
    return this.state === 'created'
  }

  get running () {
    return this.state === 'running'
  }

  get stopped () {
    return this.state === 'stopped'
  }

  changeState (state) {
    this.emit('state', this.state = state)
  }

  handleBegin () {
    const { scheduling } = this.config

    const scheduleInterval = scheduling &&
      scheduling.every &&
      scheduling.every.number &&
      scheduling.every.unit

    if (!scheduleInterval) return

    const when = util.date(scheduling.when || {})
    let { unit, number } = scheduling.every

    switch (unit) {
      case 'minute':
      case 'minutes':
        when.setMinutes(when.getMinutes() + number)
        break

      case 'hour':
      case 'hours':
        when.setHours(when.getHours() + number)
        break

      case 'week':
      case 'weeks':
        number *= 7

      case 'day':
      case 'days':
        when.setDate(when.getDate() + number)
        break

      case 'month':
      case 'months':
        when.setMonth(when.getMonth() + number)
    }

    const config = { ...this.config, scheduling: { ...scheduling, when } }
    const job = new Job(config, this.script)

    console.log(job.toObject())

    this.emit('next', job)
  }

  /**
   * @param  {String} text
   */
  log (text) {
    text = '[' + (new Date()).toISOString() + '] ' + text

    this.logs.push(text)
    this.emit('log', text)
    console.log(text)

    const { config: { reporting } } = this

    if (reporting) {
      if (reporting.discord) {
        util.request(reporting.discord, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text, username: 'zaark' })
        }).catch(err => this.emit('error', err))
      }

      if (reporting.slack) {
        util.request(reporting.slack, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        }).catch(err => this.emit('error', err))
      }
    }
  }

  /**
   * Start the job.
   *
   * @return {Promise}
   */
  async start () {
    this.changeState('running')

    const { browser, scheduling, title } = this.config

    this.result = {}

    const { headless, proxy } = browser

    const args = []

    if (proxy) {
      args.push('--proxy-server=' + proxy)
    }

    this.log(`Started "${title}"`)

    try {
      this.browser = await puppeteer.launch({ headless, args })
    } catch (err) {
      this.log('Failed to launch browser: ' + err.message)
      await this.finish()

      return
    }

    this.page = await this.browser.newPage()

    try {
      await this.setup()
    } catch (err) {
      this.log('setup() failed: ' + err.message)
      this.log('Halting job')
      await this.finish()

      return
    }

    let attempts = scheduling.attempts
    let timeout

    if (scheduling.timeout) {
      attempts = Infinity

      timeout = setTimeout(() => {
        this.stopped = true
        this.log('Timed out')
      }, scheduling.timeout * 1e3)
    }

    let i

    for (i = 0; !this.stopped && i < attempts; i++) {
      try {
        if (await this.action(i)) {
          ++i
          break
        }
      } catch (err) {
        this.stopped || this.log('action() failed: ' + err.message)
      }

      if (!this.stopped && scheduling.delay) {
        await util.sleep(scheduling.delay)
      }

      await this.page.reload()
    }

    clearTimeout(timeout)

    if (!this.stopped) {
      this.log(`Ran action() ${i} times`)

      try {
        await this.finalize()
        this.log('Result: ' + JSON.stringify(this.result))
        this.log('Completed')
      } catch (err) {
        this.log('finalize() failed: ' + err.message)
        this.log('Halting job')
      }
    }

    await this.finish()
  }

  rm () {
    this.running || this.changeState('removed')
  }

  /**
   * Stop the job gracefully (i.e. not immediately).
   */
  stop () {
    this.running && this.changeState('stopped')
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

    this.start = () => {
      throw new Error('Job already scheduled')
    }

    this.unschedule = () => {
      unschedule()
      this.rm()
    }

    this.changeState('scheduled')
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

    if (config.scheduling.when) {
      const when = util.date(config.scheduling.when)
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

    this.script = script
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
      logs: this.logs,
      state: this.state
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
    this.running && this.changeState('done')
  }
}

module.exports = Job
