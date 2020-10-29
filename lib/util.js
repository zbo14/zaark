'use strict'

const http = require('http')
const https = require('https')

/** @module util */

/**
 * @param  {(Date|Object|String)} arg
 *
 * @return {Date}
 */
const date = arg => {
  if (arg instanceof Date) return arg

  if (typeof arg === 'string') return new Date(arg)

  const date = new Date()

  arg.day != null && date.setDate(arg.day)
  arg.hour != null && date.setHour(arg.hour)
  arg.minute != null && date.setMinutes(arg.minute)
  arg.month != null && date.setMonth(arg.month)
  arg.second != null && date.setSeconds(arg.second)
  arg.year != null && date.setFullYear(arg.year)

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
  const dt = date(when)
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
  date,
  request,
  schedule,
  sleep
}
