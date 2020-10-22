'use strict'

const Joi = require('joi')

const schema = Joi.object({
  title: Joi.string().required(),
  data: Joi.object().default({}),

  browser: Joi.object({
    headless: Joi.boolean().default(true),
    proxy: Joi.string().uri({ scheme: /(?:https?|socks[45])/ }).allow('')
  }),

  reporting: Joi.object({
    discord: Joi.object({
      stream: Joi.boolean(),
      url: Joi.string().uri({ scheme: /https?/ })
    }),

    email: Joi.object({
      address: Joi.string().email(),
      host: Joi.string(),
      password: Joi.string(),
      stream: Joi.boolean()
    }),

    outputFile: Joi.string(),

    slack: Joi.object({
      stream: Joi.boolean(),
      url: Joi.string().uri({ scheme: /https?/ })
    }),

    stream: Joi.boolean(),
    timestamps: Joi.boolean()
  }).default({}),

  scheduling: Joi.object({
    when: [
      Joi.date(),
      Joi.object({
        second: Joi.number()
          .integer()
          .min(0)
          .max(59),

        minute: Joi.number()
          .integer()
          .min(0)
          .max(59),

        hour: Joi.number()
          .integer()
          .min(0)
          .max(23),

        day: Joi.number()
          .integer()
          .min(1)
          .max(31),

        month: Joi.number()
          .integer()
          .min(0)
          .max(11),

        year: Joi.number()
          .integer()
          .min(2020)
          .max(2030)
      }).allow(null)
    ],

    retries: Joi.number()
      .integer()
      .min(0)
      .default(0),

    retryDelay: Joi.number()
      .integer()
      .min(0)
      .default(0),

    timeout: Joi.number()
      .integer()
      .min(0)
      .default(0)
  })
})

exports.from = config => {
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config)
    } catch {
      throw new Error('Expected config file to contain valid JSON')
    }
  }

  if (!config.constructor || config.constructor.name !== 'Object') {
    throw new Error('Expected config to be an object literal')
  }

  const { value, error } = schema.validate(config)

  if (error) {
    throw new Error(error.message)
  }

  return value
}
