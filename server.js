'use strict'

const fs = require('fs')
const path = require('path')
const Server = require('./lib/server')

const privDir = path.join(__dirname, 'private')

const apiKey = fs.readFileSync(path.join(privDir, 'api.key'), 'utf8').trim()
const cert = fs.readFileSync(path.join(privDir, 'cert.pem'))
const key = fs.readFileSync(path.join(privDir, 'key.pem'))

const server = new Server({ apiKey, cert, key })

server
  .start(8888, '0.0.0.0')
  .then(() => console.log('Server started!'))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
