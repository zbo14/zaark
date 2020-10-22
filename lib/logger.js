'use strict'

const fs = require('fs')
const stream = require('stream')
const util = require('./util')

class Logger extends stream.Writable {
  constructor (config) {
    super()

    this.config = config
    this.data = ''

    this.output = config.reporting.outputFile
      ? fs.createWriteStream(config.reporting.outputFile)
      : process.stdout

    this.transport = config.reporting.email && util.createEmailTransport(config.reporting.email)
  }

  log (chunk) {
    this.write(chunk + '\n')
  }

  sendDiscord (discord, content) {
    return util.request(discord.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content, username: 'zaark' })
    }).catch(err => this.emit('error', err))
  }

  sendEmail (email, text) {
    return this.transport.sendMail({
      from: 'zaark',
      to: email.address,
      subject: this.config.title,
      text: text
    }).catch(err => this.emit('error', err))
  }

  sendSlack (slack, text) {
    return util.request(slack.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    }).catch(err => this.emit('error', err))
  }

  async _write (chunk, _, cb) {
    const {
      discord,
      email,
      slack,
      stream,
      timestamps
    } = this.config.reporting
    chunk = timestamps
      ? '[' + new Date().toISOString() + '] ' + chunk
      : chunk.toString()

    this.data += chunk
    this.output.write(chunk)

    await Promise.all([
      Object.keys(discord || {}).length &&
        (typeof discord.stream === 'boolean' ? discord.stream : stream) &&
        this.sendDiscord(discord, chunk),

      Object.keys(email || {}).length &&
        (typeof email.stream === 'boolean' ? email.stream : stream) &&
        this.sendEmail(email, chunk),

      Object.keys(slack || {}).length &&
        (typeof slack.stream === 'boolean' ? slack.stream : stream) &&
        this.sendSlack(slack, chunk)
    ])

    cb()
  }

  async _final (cb) {
    const {
      discord,
      email,
      slack,
      stream
    } = this.config.reporting

    await Promise.all([
      Object.keys(discord || {}).length &&
        !(typeof discord.stream === 'boolean' ? discord.stream : stream) &&
        this.sendDiscord(discord, this.data),

      Object.keys(email || {}).length &&
        !(typeof email.stream === 'boolean' ? email.stream : stream) &&
        this.sendEmail(email, this.data),

      Object.keys(slack || {}).length &&
        !(typeof slack.stream === 'boolean' ? slack.stream : stream) &&
        this.sendSlack(slack, this.data)
    ])

    cb()
  }
}

module.exports = Logger
