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
    const args = ['--disable-web-security']

    if (proxy) {
      args.push('--proxy-server=' + proxy)
    }

    this.browser = await puppeteer.launch({ headless, args })
    this.page = await this.browser.newPage()

    try {
      await this.setup()
    } catch (err) {
      this.logger.log('setup() rejected: ' + err.message)
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

    this.logger.log(`Started "${title}"`)

    let i, ready

    for (i = 0; !this.stopped && i < 1 + retries; i++) {
      try {
        if ((ready = await this.monitor())) break
      } catch (err) {
        this.stopped || this.logger.log('monitor() rejected: ' + err.message)
      }

      if (!this.stopped && scheduling.retryDelay) {
        await util.sleep(scheduling.retryDelay)
      }

      await this.page.reload()
    }

    if (!this.stopped) {
      if (ready) {
        this.logger.log(`Ready (${i} retries)`)

        let success

        try {
          success = await this.action()
        } catch (err) {
          this.logger.log(err)
          this.logger.log('action() rejected: ' + err.message)
        }

        this.logger.log('Status: ' + (success ? 'success' : 'failed'))
        this.logger.log('Result: ' + JSON.stringify(this.result))
      } else {
        this.logger.log(`Not ready (${i - 1} retries)`)
      }

      this.logger.log('Completed')
    }

    clearTimeout(timeout)

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

    if (typeof context.setup !== 'function') {
      throw new Error('Expected setup to be a function')
    }

    if (typeof context.monitor !== 'function') {
      throw new Error('Expected monitor to be a function')
    }

    if (typeof context.action !== 'function') {
      throw new Error('Expected action to be a function or string')
    }

    this.action = context.action.bind(this)
    this.setup = context.setup.bind(this)
    this.monitor = context.monitor.bind(this)
  }

  /**
   * Return an object representation of a job's state/config.
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

  async finish () {
    await this.browser.close()

    this.running = false

    this.logger.end()
    this.emit('end')
  }

  sleep (...args) {
    return util.sleep(...args)
  }
}

module.exports = Job
