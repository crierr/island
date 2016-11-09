import 'source-map-support/register';
import * as island from '../controllers/endpoint-decorator';

const v = island.validate;
const s = island.sanitize;

describe('validate', () => {
  it('should support any', () => {
    const result = island.validate.validate(island.validate.Any);
    expect(result).toEqual({ type: 'any' });
  });
  it('should support primitive types itself', () => {
    const result1 = island.validate.validate(String);
    expect(result1).toEqual({ type: 'string' });
    const result2 = island.validate.validate(Number);
    expect(result2).toEqual({ type: 'number' });
    const result3 = island.validate.validate(Boolean);
    expect(result3).toEqual({ type: 'boolean' });
  });
  it('should support empty object', () => {
    const result = v.validate(island.validate.Object());
    expect(result).toEqual({
      type: 'object'
    });
  });
  it(`should convert query validation`, () => {
    const result = island.validate.validate({
      'aid?': v.ObjectId,
      vcode: Number,
      dcode: Number,
      name: String,
      slot: Number,
      cider: v.Cider,
      number: v.NumberOrQuery
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        aid: { type: '$oid', optional: true },
        vcode: { type: 'number', optional: false },
        dcode: { type: 'number', optional: false },
        name: { type: 'string', optional: false },
        slot: { type: 'number', optional: false },
        cider: { type: '$cider', optional: false },
        number: { type: '$numberOrQuery', optional: false }
      }
    });
  });
  it('should support array', () => {
    const result = v.validate([v.Cider]);
    expect(result).toEqual({
      type: 'array',
      items:{ type: '$cider', optional: false }
    });
  });
  it('should support empty array', () => {
    const result = v.validate(island.validate.Array());
    expect(result).toEqual({
      type: 'array'
    });
  });
  it('should support boolean', () => {
    const result = v.validate({ a: Boolean })
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'boolean', optional: false }
      }
    });
  });
  it('should override value by key with ?', () => {
    const result = v.validate({
      'jti?': v.String({ exactLength: 32 }),
      offset: Number,
      limit: v.Number({ lte: 100 })
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        jti: { type: 'string', exactLength: 32, optional: true },
        offset: { type: 'number', optional: false },
        limit: { type: 'number', lte: 100, optional: false }
      }
    });
  });
  it('should support complex type with String', () => {
    const result1 = v.validate(v.String({ eq: ['haha', 'hoho']}));
    expect(result1).toEqual({
      type: 'string',
      eq: ['haha', 'hoho']
    });
    const result2 = v.validate({
      'jti?': v.String({ exactLength: 32 }),
      grant_type: v.String({ eq: ['password', 'client_credentials'] }),
      token_type: v.String({ eq: 'Bearer' })
    });
    expect(result2).toEqual({
      type: 'object',
      properties: {
        jti: { type: 'string', exactLength: 32, optional: true },
        grant_type: { type: 'string', eq: ['password', 'client_credentials'], optional: false },
        token_type: { type: 'string', eq: 'Bearer', optional: false }
      }
    });
  });
  it('should support complex type with Number', () => {
    const result = v.validate({
      offset: Number,
      limit: v.Number({ lte: 100 })
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        offset: { type: 'number', optional: false },
        limit: { type: 'number', lte: 100, optional: false }
      }
    });
  });
  it('should support postfix for key', () => {
    const result = island.validate.validate({
      a: Number,
      'b?': Number,
      'c!': Number
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'number', optional: false },
        b: { type: 'number', optional: true },
        c: { type: 'number', optional: false }
      }
    });
  });
  it('should support nested object', () => {
    const result = island.validate.validate({
      a: v.Object({
        b: Number,
        'c?': String
      })
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { optional: false, type: 'object', properties: {
          b: {type: 'number', optional: false},
          c: {type: 'string', optional: true}}}}
    });
  });
  it('should support nested nested object', () => {
    const result = island.validate.validate({
      a: v.Object({b: v.Object({'c?': String })})
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: {optional: false, type: 'object', properties: {
          b: {type: 'object', optional: false, properties: {
            c: {type: 'string', optional: true}}}}}}
    });
  });
  it('should support array of array', () => {
    const result = island.validate.validate([v.Array([Number])]);
    expect(result).toEqual({
      type: 'array',
      items: { type: 'array', optional: false,
        items: { type: 'number', optional: false }
      }
    });
  });
  it('should support array of object', () => {
    const result = island.validate.validate([v.Object({
      a: Number
    })]);
    expect(result).toEqual({
      type: 'array',
      items: { type: 'object', optional: false,
        properties: { a: { type: 'number', optional: false } }
      }
    });
  });
  it('should support object of array', () => {
    const result = island.validate.validate({
      a: v.Array([Number])
    });
    expect(result).toEqual({
      type: 'object',
      properties: { a: { type: 'array', optional: false,
        items: { type: 'number', optional: false }
      }
    }});
  });
});

describe('sanitize', () => {
  it('should support primitive types itself', () => {
    const result1 = island.sanitize.sanitize(String);
    expect(result1).toEqual({ type: 'string' });
    const result2 = island.sanitize.sanitize(Number);
    expect(result2).toEqual({ type: 'number' });
    const result3 = island.sanitize.sanitize(Boolean);
    expect(result3).toEqual({ type: 'boolean' });
  });
  it(`should convert query sanitization`, () => {
    const result = island.sanitize.sanitize({
      'aid?': s.ObjectId,
      vcode: 1,
      dcode: 1,
      name: String,
      slot: 1,
      cider: s.Cider,
      number: s.NumberOrQuery,
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        aid: { type: '$oid', optional: true },
        vcode: { type: 'number', def: 1, optional: true },
        dcode: { type: 'number', def: 1, optional: true },
        name: { type: 'string', optional: true },
        slot: { type: 'number', def: 1, optional: true },
        cider: { optional: true, type: '$cider' },
        number: { optional: true, type: '$numberOrQuery' }
      }
    });
  });
  it('should sanitize string', () => {
    const result = island.sanitize.sanitize({
      aid: s.ObjectId,
      expireAt: Number,
      reason: ''
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        aid: { type: '$oid', optional: true },
        expireAt: { type: 'number', optional: true },
        reason: { type: 'string', def: '', optional: true }
      }
    });
  });
  it('should support boolean', () => {
    const result = island.sanitize.sanitize({ a: Boolean });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'boolean', optional: true }
      }
    });
  });
  it('should support postfix for key', () => {
    const result = island.sanitize.sanitize({
      a: Number,
      'b?': Number,
      'c!': Number
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'number', optional: true },
        b: { type: 'number', optional: true },
        c: { type: 'number', optional: false }
      }
    });
  });
  it('should support object of object', () => {
    const result = island.sanitize.sanitize({
      a: s.Object({
        b: Number,
        'c?': String
      })
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { optional: true, type: 'object', properties: {
          b: {type: 'number', optional: true},
          c: {type: 'string', optional: true}}}}
    });
  });
  it('should support object of object of object', () => {
    const result = island.sanitize.sanitize({
      a: s.Object({b: s.Object({'c?': String })})
    });
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: {optional: true, type: 'object', properties: {
          b: {type: 'object', optional: true, properties: {
            c: {type: 'string', optional: true}}}}}}
    });
  });
  it('should support array of array', () => {
    const result = island.sanitize.sanitize([s.Array([Number])]);
    expect(result).toEqual({
      type: 'array',
      items: { type: 'array', optional: true,
        items: { type: 'number', optional: true }
      }
    });
  });
  it('should support array of object', () => {
    const result = island.sanitize.sanitize([s.Object({
      a: Number
    })]);
    expect(result).toEqual({
      type: 'array',
      items: { type: 'object', optional: true,
        properties: { a: { type: 'number', optional: true } }
      }
    });
  });
  it('should support object of array', () => {
    const result = island.sanitize.sanitize({
      a: s.Array([Number])
    });
    expect(result).toEqual({
      type: 'object',
      properties: { a: { type: 'array', optional: true,
        items: { type: 'number', optional: true }
      }
    }});
  });
});
