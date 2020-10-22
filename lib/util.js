'use strict'

const http = require('http')
const https = require('https')
const nodemailer = require('nodemailer')

/** @module util */

/**
 * @param  {Object} args
 * @param  {String} args.address
 * @param  {String} args.host
 * @param  {String} args.password
 *
 * @return {Object}
 */
const createEmailTransport = ({ address, host, password }) => {
  return nodemailer.createTransport({
    secure: true,
    host,
    auth: {
      user: address,
      pass: password
    }
  })
}

/**
 * @param  {Object}  args
 * @param  {Number}  args.day
 * @param  {Number}  args.hour
 * @param  {Number}  args.minute
 * @param  {Number}  args.month
 * @param  {Number}  args.second
 * @param  {Number}  args.year
 *
 * @return {Date}
 */
const date = ({
  day,
  hour,
  minute,
  month,
  second,
  year
} = {}) => {
  const date = new Date()

  day != null && date.setDate(day)
  hour != null && date.setHour(hour)
  minute != null && date.setMinutes(minute)
  month != null && date.setMonth(month)
  second != null && date.setSeconds(second)
  year != null && date.setFullYear(year)

  return date
}

/**
 * @param  {String}  url
 * @param  {Object}  opts
 *
 * @return {Promise}
 */
const request = (url, opts) => new Promise((resolve, reject) => {
  try {
    url = new URL(url)
  } catch {
    return reject(new Error('Invalid URL: ' + url))
  }

  const { request } = url.protocol === 'https:' ? https : http

  request(url, opts, resp => {
    const { statusCode, headers } = resp

    let body = ''

    resp
      .on('data', chunk => {
        body += chunk
      })
      .once('end', () => resolve({ statusCode, headers, body }))
      .once('error', reject)
  })
    .end(opts.body || '')
    .once('error', reject)
})

/**
 * @param  {Function}       fn
 * @param  {(Date|Object)}  when
 *
 * @return {Function}
 */
const schedule = (fn, when) => {
  const tm = process.hrtime()
  const dt = when instanceof Date ? when : date(when)
  const now = new Date()
  let ms = dt - now

  if (ms < 0) {
    throw new Error('Cannot schedule in the past')
  }

  const [s, ns] = process.hrtime(tm)
  ms -= s * 1e3 + ns / 1e3

  const timeout = setTimeout(fn, ms)

  return () => clearTimeout(timeout)
}

/**
 * @param  {Number} ms
 *
 * @return {Promise}
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = {
  createEmailTransport,
  date,
  request,
  schedule,
  sleep
}
