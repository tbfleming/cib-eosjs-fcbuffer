/* eslint-env mocha */
const assert = require('assert')
const ByteBuffer = require('bytebuffer')

const Fcbuffer = require('.')
const Types = require('./types')
const Struct = require('./struct')
const {create} = require('./fcbuffer')

describe('API', function () {
  it('bytes', function () {
    const {bytes} = Types()
    const type = bytes()
    assertSerializer(type, '00aaeeff')
    assertRequired(type)
  })

  it('string', function () {
    const {string} = Types()
    const type = string()
    assertSerializer(type, '爱')
    assertRequired(type)
  })

  it('vector', function () {
    const {vector, string} = Types()
    throws(() => vector('string'), /vector type should be a serializer/)
    const unsortedVector = vector(string())
    assertRequired(unsortedVector)

    assert.deepEqual(unsortedVector.fromObject(['z', 'z']), ['z', 'z']) // allows duplicates
    assert.deepEqual(unsortedVector.fromObject(['z', 'a']), ['z', 'a']) // does not sort
    assertSerializer(unsortedVector, ['z', 'a'])

    const sortedVector = vector(string(), true)
    assert.deepEqual(sortedVector.fromObject(['z', 'a']), ['a', 'z']) //sorts
    assertSerializer(sortedVector, ['a', 'z'])
  })

  it('FixedBytes', function () {
    const {fixed_bytes16} = Types()
    const type = fixed_bytes16()
    assertSerializer(type, Array(16 + 1).join('ff')) // hex string
    throws(() => assertSerializer(type, Array(17 + 1).join('ff')), /fixed_bytes16 length 17 does not equal 16/)
    assertRequired(type)
  })

  it('FixedString', function () {
    const {fixed_string16} = Types()
    const type = fixed_string16()
    assertSerializer(type, '1234567890123456')
    throws(() => assertSerializer(type, '12345678901234567'), /exceeds maxLen 16/)
    assertRequired(type)
  })

  it('TypesAll', function () {
    const types = Types()
    for (let typeName of Object.keys(types)) {
      const fn = types[typeName]
      if(typeName === 'map') {
        fn([types.string(), types.string()])
      } else if (typeof fn === 'function') {
        fn(types.string())
      }
    }
  })

  it('time', function () {
    const {time} = Types()
    const type = time()

    throws(() => type.fromObject({}), /Unknown date type/)
    type.fromObject(new Date())
    type.fromObject(1000)
    type.fromObject('1970-01-01T00:00:00')

    assertSerializer(type, '1970-01-01T00:00:00')
    assertSerializer(type, '2106-02-07T06:28:15')
    throws(() => assertSerializer(type, '1969-12-31T23:59:59Z'), /format/) // becomes -1
    throws(() => assertSerializer(type, '2106-02-07T06:28:16Z'), /Overflow/)
    assertRequired(type)
  })

  it('optional', function () {
    const {optional, string} = Types()
    const type = optional(string())
    throws(() => optional('string'), /optional parameter should be a serializer/)
    assertSerializer(type, 'str')
    assertSerializer(type, null)
    assertSerializer(type, undefined)
  })

  it('uint', function () {
    const {uint8} = Types()
    const type = uint8()
    assertSerializer(type, 0)
    assertSerializer(type, 255)
    throws(() => assertSerializer(type, 256), /Overflow/)
    throws(() => assertSerializer(type, -1), /format/)
    assertRequired(type)
  })

  it('uint64', function () {
    const {uint64} = Types()
    const type = uint64()

    assertSerializer(type, '18446744073709551615')
    assertSerializer(type, '0')
    throws(() => assertSerializer(type, '18446744073709551616'), /Overflow/)
    throws(() => assertSerializer(type, '-1'), /format/)
    assertRequired(type)
  })

  it('int', function () {
    const {int8} = Types()
    const type = int8()
    assertSerializer(type, -128)
    assertSerializer(type, 127)
    throws(() => assertSerializer(type, -129), /Overflow/)
    throws(() => assertSerializer(type, 128), /Overflow/)
    assertRequired(type)
  })

  it('int64', function () {
    const {int64} = Types()
    const type = int64()

    assertSerializer(type, '9223372036854775807')
    assertSerializer(type, '-9223372036854775808')
    throws(() => assertSerializer(type, '9223372036854775808'), /Overflow/)
    throws(() => assertSerializer(type, '-9223372036854775809'), /Overflow/)
    assertRequired(type)
  })

  it('struct', function () {
    const {vector, uint16, fixed_bytes33} = Types()

    const KeyPermissionWeight = Struct('KeyPermissionWeight')
    KeyPermissionWeight.add('key', fixed_bytes33())
    KeyPermissionWeight.add('weight', uint16())

    const type = vector(KeyPermissionWeight)
    assertSerializer(type, [
      {key: Array(33 + 1).join('00'), weight: 1},
      {key: Array(33 + 1).join('00'), weight: 1}
    ])
  })
})

describe('JSON', function () {
  it('Structure', function () {
    assertCompile({Struct: {fields: {checksum: 'fixed_bytes32'}}})
    throws(() => assertCompile({Struct: {}}), /Expecting Struct.fields or Struct.base/)
    throws(() => assertCompile({Struct: {base: {obj: 'val'}}}), /Expecting string/)
    throws(() => assertCompile({Struct: {fields: 'string'}}), /Expecting object/)
    throws(() => assertCompile({Struct: {fields: {name: {obj: 'val'}}}}), /Expecting string in/)
    throws(() => assertCompile({Struct: 0}), /Expecting object or string/)
  })

  it('Debug', function () {
    assertCompile(
      {name: 'string', Person: {fields: {name: 'name'}}},
      {defaults: true, debug: true}
    )
  })

  it('typedef', function () {
    throws(() => assertCompile({Type: 'UnknownType'}), /Unrecognized type/)
    assertCompile({name: 'string', Person: {fields: {name: 'name'}}})
    assertCompile({name: 'string', MyName: 'name', Person: {fields: {name: 'MyName'}}})
  })

  it('typedef', function () {
    assertCompile({Event: {fields: {time: 'time'}}})
  })

  it('Inherit', function () {
    throws(() => assertCompile({Struct: {fields: {name: 'name'}}}), /Missing name/)
    throws(() => assertCompile({Struct: {base: 'string'}}), /Missing string in Struct.base/)
    throws(() => assertCompile({
      Person: {base: 'Human', fields: {name: 'string'}}}
    ), /Missing Human/)

    throws(() => assertCompile({
      Human: 'string', // Human needs to be struct not a type
      Person: {base: 'Human', fields: {name: 'string'}}}
    ), /Missing Human/)

    assertCompile({
      Boolean: 'uint8',
      Human: {fields: {Alive: 'Boolean'}},
      Person: {base: 'Human', fields: {name: 'string'}}
    })
  })

  it('optional', function () {
    const {Person} = assertCompile({Person: {fields: {name: 'string?'}}}, {defaults: false})
    assertSerializer(Person, {name: 'Jane'})
    assertSerializer(Person, {name: null})
    assertSerializer(Person, {name: undefined})
    // assertSerializer(Person, {})  {"name": [null]} // TODO ???
  })

  it('Vectors', function () {
    throws(() => assertCompile({Person: {fields: {name: 'vector[TypeArg]'}}}), /Missing TypeArg/)
    throws(() => assertCompile({Person: {fields: {name: 'BaseType[]'}}}), /Missing BaseType/)
    throws(() => assertCompile({Person: {fields: {name: 'BaseType[string]'}}}), /Missing BaseType/)
    assertCompile({Person: {fields: {name: 'vector[string]'}}})
    assertCompile({Person: {fields: {name: 'string'}}, Conference: {fields: {attendees: 'Person[]'}}})
    const {Person} = assertCompile({Person: {fields: {friends: 'string[]'}}})
    assertSerializer(Person, {friends: ['Dan', 'Jane']})
  })

  it('Errors', function () {
    const {structs} = create({Struct: {fields: {age: 'string'}}}, Types({defaults: true}))
    const type = structs.Struct
    throws(() => Fcbuffer.fromBuffer(type, Buffer.from('')), /Illegal offset/)
  })
})

describe('Override', function () {

  it('type', function () {
    const definitions = {
      asset: {
        fields: {
          amount: 'string', // another definition (like transfer)
          symbol: 'string'
        }
      }
    }
    const override = {
      'asset.fromObject': (value) => {
        const [amount, symbol] = value.split(' ')
        return {amount, symbol}
      },
      'asset.toObject': (value) => {
        const {amount, symbol} = value
        return `${amount} ${symbol}`
      }
    }
    const {structs, errors} = create(definitions, Types({override}))
    assert.equal(errors.length, 0)
    const asset = structs.asset.fromObject('1 EOS')
    assert.deepEqual(asset, {amount: 1, symbol: 'EOS'})
    assert.deepEqual('1 EOS', structs.asset.toObject(asset))
  })

  it('field', function () {
    const definitions = {
      message: {
        fields: {
          type: 'string', // another definition (like transfer)
          data: 'bytes'
        }
      },
      transfer: {
        fields: {
          from: 'string',
          to: 'string'
        }
      }
    }
    const override = {
      'message.data.fromByteBuffer': ({fields, object, b, config}) => {
        const ser = (object.type || '') == '' ? fields.data : structs[object.type]
        b.readVarint32()
        object.data = ser.fromByteBuffer(b, config)
      },
      'message.data.appendByteBuffer': ({fields, object, b}) => {
        const ser = (object.type || '') == '' ? fields.data : structs[object.type]
        const b2 = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY, ByteBuffer.LITTLE_ENDIAN)
        ser.appendByteBuffer(b2, object.data)
        b.writeVarint32(b2.offset)
        b.append(b2.copy(0, b2.offset), 'binary')
      },
      'message.data.fromObject': ({fields, object, result}) => {
        const {data, type} = object
        const ser = (type || '') == '' ? fields.data : structs[type]
        result.data = ser.fromObject(data)
      },
      'message.data.toObject': ({fields, object, result, config}) => {
        const {data, type} = object || {}
        const ser = (type || '') == '' ? fields.data : structs[type]
        result.data = ser.toObject(data, config)
      }
    }
    const {structs, errors} = create(definitions, Types({override, debug: true}))
    assert.equal(errors.length, 0)
    assertSerializer(structs.message, {
      type: 'transfer',
      data: {
        from: 'slim',
        to: 'luke'
      }
    })
  })
})

describe('Custom Type', function () {
  it('Implied Decimal', function () {
    
    const customTypes = {
      implied_decimal: ()=> [ImpliedDecimal, {decimals: 4}]
    }

    const definitions = {
      asset: {
        fields: {
          amount: 'implied_decimal',
          symbol: 'string'
        }
      }
    }

    const ImpliedDecimal = ({decimals}) => {
      return {
        fromByteBuffer: (b) => b.readVString(),
        appendByteBuffer: (b, value) => {b.writeVString(value.toString())},
        fromObject (value) {
          let [num = '', dec = ''] = value.split('.')
          // if(dec.length > decimals) { throw TypeError(`Adjust precision to only ${decimals} decimal places.`) }
          dec += '0'.repeat(decimals - dec.length)
          return `${num}.${dec}`
        },
        toObject: (value) => value
      }
    }

    const {structs, errors} = Fcbuffer(definitions, {customTypes})
    assert.equal(errors.length, 0)
    const asset = structs.asset.fromObject({amount: '1', symbol: 'EOS'})
    assert.deepEqual(asset, {amount: '1.0000', symbol: 'EOS'})
  })
})

function assertCompile (definitions, config) {
  config = Object.assign({defaults: true, debug: false}, config)
  const {errors, structs} = create(definitions, Types(config))
  assert.equal(errors.length, 0, errors[0])
  assert(Object.keys(structs).length > 0, 'expecting struct(s)')
  for (const struct in structs) {
    const type = structs[struct]
    // console.log(struct, JSON.stringify(structs[struct].toObject(), null, 0), '\n')
    assertSerializer(type, type.toObject())
  }
  return structs
}

function assertSerializer (type, value) {
  const obj = type.fromObject(value) // tests fromObject
  const buf = Fcbuffer.toBuffer(type, obj) // tests appendByteBuffer
  const obj2 = Fcbuffer.fromBuffer(type, buf) // tests fromByteBuffer
  const obj3 = type.toObject(obj) // tests toObject
  deepEqual(value, obj3, 'serialize object')
  deepEqual(obj3, obj2, 'serialize buffer')
}

function assertRequired (type) {
  throws(() => assertSerializer(type, null), /Required/)
  throws(() => assertSerializer(type, undefined), /Required/)
}

/* istanbul ignore next */
function deepEqual (arg1, arg2, message) {
  try {
    assert.deepEqual(arg1, arg2, message)
    // console.log('deepEqual arg1', arg1, '\n', JSON.stringify(arg1))
    // console.log('deepEqual arg2', arg2, '\n', JSON.stringify(arg2))
  } catch (error) {
    // console.error('deepEqual arg1', arg1, '\n', JSON.stringify(arg1))
    // console.error('deepEqual arg2', arg2, '\n', JSON.stringify(arg2))
    throw error
  }
}

/* istanbul ignore next */
function throws (fn, match) {
  try {
    fn()
    assert(false, 'Expecting error')
  } catch (error) {
    if (!match.test(error)) {
      error.message = `Error did not match ${match}\n${error.message}`
      throw error
    }
  }
}
