'use strict'

const Tags = require('opentracing').Tags

function createWrapInternalSendCommand (tracer, config) {
  return function wrapInternalSendCommand (internalSendCommand) {
    return function internalSendCommandWithTrace (options) {
      const span = startSpan(tracer, config, this, options.command)

      options.callback = wrapCallback(tracer, span, options.callback)

      return internalSendCommand.call(this, options)
    }
  }
}

function createWrapSendCommand (tracer, config) {
  return function wrapSendCommand (sendCommand) {
    return function sendCommandWithTrace (cmd, args, cb) {
      const span = startSpan(tracer, config, this, cmd)

      if (!cb && args && typeof args[args.length - 1] === 'function') {
        cb = args.pop()
      }

      return sendCommand.call(this, cmd, args, wrapCallback(tracer, span, cb))
    }
  }
}

function startSpan (tracer, config, client, command) {
  const scope = tracer.scopeManager().active()
  const span = tracer.startSpan('redis.command', {
    childOf: scope && scope.span(),
    tags: {
      [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
      [Tags.DB_TYPE]: 'redis',
      'service.name': config.service || `${tracer._service}-redis`,
      'resource.name': command,
      'span.type': 'redis',
      'db.name': client.selected_db || '0'

    }
  })

  const address = client.address.split(':')

  if (address[0] && address[1]) {
    span.addTags({
      'out.host': address[0],
      'out.port': address[1]
    })
  }

  return span
}

function wrapCallback (tracer, span, done) {
  return (err, res) => {
    if (err) {
      span.addTags({
        'error.type': err.name,
        'error.msg': err.message,
        'error.stack': err.stack
      })
    }

    span.finish()

    if (done) {
      done(err, res)
    }
  }
}

module.exports = [
  {
    name: 'redis',
    versions: ['^2.6'],
    patch (redis, tracer, config) {
      this.wrap(redis.RedisClient.prototype, 'internal_send_command', createWrapInternalSendCommand(tracer, config))
    },
    unpatch (redis) {
      this.unwrap(redis.RedisClient.prototype, 'internal_send_command')
    }
  },
  {
    name: 'redis',
    versions: ['>=2 <2.6'],
    patch (redis, tracer, config) {
      this.wrap(redis.RedisClient.prototype, 'send_command', createWrapSendCommand(tracer, config))
    },
    unpatch (redis) {
      this.unwrap(redis.RedisClient.prototype, 'send_command')
    }
  }
]
