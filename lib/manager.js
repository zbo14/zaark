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
   * @param {Object} config
   * @param {String} script
   */
  addJob (config, script) {
    const job = new Job(config, script)

    const handleState = job => state => {
      state === 'removed' && this.jobs.delete(job.id)
    }

    const handleNext = job => {
      job
        .on('error', console.error)
        .on('state', handleState(job))
        .once('next', handleNext)

      this.jobs.set(job.id, job)
    }

    job
      .on('error', console.error)
      .on('state', handleState(job))
      .once('next', handleNext)

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
}

module.exports = Manager
