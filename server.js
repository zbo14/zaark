'use strict'

const fs = require('fs')
const path = require('path')
const Server = require('./lib/server')

const cert = fs.readFileSync(path.join(__dirname, 'private', 'cert.pem'))
const key = fs.readFileSync(path.join(__dirname, 'private', 'key.pem'))

const server = new Server({ cert, key })

server
  .start(8888, '0.0.0.0')
  .then(() => console.log('Server started!'))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
