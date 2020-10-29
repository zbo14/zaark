#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const Manager = require('./lib/manager')

const dir = process.argv[2]

if (!dir) {
  console.error('Expected path to directory')
  process.exit(1)
}

const manager = new Manager()

const config = fs.readFileSync(path.join(dir, 'config.json'), 'utf8')
const script = fs.readFileSync(path.join(dir, 'script.js'), 'utf8')

const job = manager.addJob(config, script)

job.scheduled || job.start()
