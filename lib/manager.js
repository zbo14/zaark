'use strict'

const Job = require('./job')

/**
 * Class for managing multiple jobs.
 */
class Manager {
  constructor () {
    this.jobs = new Map()
  }

  /**
   * Create a job with a given config and script.
   *
   * @param {Object} config [description]
   * @param {String} script [description]
   */
  addJob (config, script) {
    const job = new Job(config, script)

    job.once('end', () => this.jobs.delete(job.id))

    this.jobs.set(job.id, job)

    return job
  }

  /**
   * Get a job by its id.
   *
   * @param  {String} id
   *
   * @return {Job}
   */
  getJob (id) {
    return this.jobs.get(id)
  }

  /**
   * Get all jobs.
   *
   * @return {Job[]}
   */
  getJobs () {
    return [...this.jobs.values()]
  }

  /**
   * Stop all jobs currently running.
   */
  stop () {
    this.jobs.forEach(job => job.stop())
  }
}

module.exports = Manager
