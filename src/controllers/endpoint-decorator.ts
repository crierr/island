import * as Promise from 'bluebird';
import * as _ from 'lodash';
import { logger } from '../utils/logger';

export interface EndpointOptions {
  scope?: {
    resource: number;
    authority: number;
  };
  version?: string;
  schema?: EndpointSchemaOptions;
  developmentOnly?: boolean;
  ignoreSession?: boolean;
  level?: number;
  admin?: boolean;
}

export interface EndpointSchemaOptions {
  body?: {
    sanitization?: any;
    validation?: any;
  };
  query?: {
    sanitization?: any;
    validation?: any;
  };
  params?: {
    sanitization?: any;
    validation?: any;
  };
  session?: {
    sanitization?: any;
    validation?: any;
  };
  result?: {
    sanitization?: any;
    validation?: any;
  };
}


type SchemaInspectorProperty = {
  optional?: boolean;
  def?: any;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'date' | 'object' | 'array' | 'any' | '$oid' | '$cider' | '$numberOrQuery';
  properties?: any;
  items?: any | [any];
}


function makeDecorator<Property>(func, type, subType) {
  return (obj: Property | {[key: string]: Property} | [Property]) => {
    return (target, key, desc: PropertyDescriptor) => {
      const options = desc.value.options = (desc.value.options || {}) as EndpointOptions;
      _.merge(options, { schema: { [subType]: { [type]: func(obj) } } });
      if (desc.value.endpoints) {
        desc.value.endpoints.forEach(e => _.merge(e.options, options));
      }
    };
  };
}


export namespace sanitize {
  export interface _ObjectId { $sanitize: Symbol; }
  export const ObjectId: _ObjectId = { $sanitize: Symbol() };
  export interface _Cider { $sanitize: Symbol; }
  export const Cider: _Cider = { $sanitize: Symbol() };
  export interface _Any { $sanitize: Symbol; }
  export const Any: _Any = { $sanitize: Symbol() };
  export interface _NumberOrQuery { $sanitize: Symbol; }
  export const NumberOrQuery: _NumberOrQuery = { $sanitize: Symbol() }

  export interface __Number {
    def?: number;
    min?: number;
    max?: number;
    strict?: boolean;
  }


  export class _Number implements __Number {
    def: number;
    min: number;
    max: number;
    strict: boolean;

    constructor ({def, min, max, strict}: __Number) {
      this.def = def;
      this.min = min;
      this.max = max;
      this.strict = strict;
    }
  }


  export function Number({def, min, max, strict}: __Number) {
    return new _Number({def, min, max, strict});
  }


  export type _StringRules = 'upper' | 'lower' | 'title' | 'capitalize' | 'ucfirst' | 'trim';


  export interface __String {
    def?: string;
    rules?: _StringRules | [_StringRules];
    minLength?: number;
    maxLength?: number;
    strict: boolean;
  }


  export class _String implements __String {
    def: string;
    rules: _StringRules | [_StringRules]
    minLength: number;
    maxLength: number;
    strict: boolean;

    constructor ({def, rules, minLength, maxLength, strict}: __String) {
      this.def = def;
      this.rules = rules;
      this.minLength = minLength;
      this.maxLength = maxLength;
      this.strict = strict;
    }
  }

  export function String({def = undefined, rules = undefined, minLength = undefined, maxLength = undefined, strict = undefined}) {
    return new _String({def, rules, minLength, maxLength, strict});
  }


  export class _Object {
    properties: { [key: string]: SanitizePropertyTypes };

    constructor(obj?: { [key: string]: SanitizePropertyTypes }) {
      this.properties = obj;
    }
  }


  export function Object(obj: { [key: string]: SanitizePropertyTypes }) {
    return new _Object(obj);
  }


  export class _Array {
    items: [SanitizePropertyTypes];

    constructor(items: [SanitizePropertyTypes]) {
      this.items = items;
    }
  }


  export function Array(items: [SanitizePropertyTypes]) {
    return new _Array(items);
  }


  export type SanitizePropertyTypes =
    typeof global.String | string | _String |
    typeof global.Number | number | _Number |
    typeof Boolean | typeof Date | _Object | _Array | _Any |
    _ObjectId | _Cider | _NumberOrQuery;

  function parseSanitization(property: SchemaInspectorProperty, value: SanitizePropertyTypes) {
    if (value === undefined) return;

    if (value === global.String) {
      property.type = 'string';
    } else if (typeof value === 'string') {
      property.type = 'string';
      property.def = value;
    } else if (value instanceof _String) {
      property.type = 'string';
      _.merge(property, value);
    } else if (value === global.Number) {
      property.type = 'number';
    } else if (typeof value === 'number') {
      property.type = 'number';
      property.def = value;
    } else if (value instanceof _Number) {
      property.type = 'number';
      _.merge(property, value);
    } else if (value === Boolean) {
      property.type = 'boolean';
    } else if (value === Date) {
      property.type = 'date';
    } else if (value instanceof _Object) {
      property.type = 'object';
      property.properties = sanitizeAsObject(value.properties);
    } else if (value instanceof _Array) {
      property.type = 'array';
      property.items = sanitizeAsArray(value.items);
    } else if (value === ObjectId) {
      property.type = '$oid';
    } else if (value === Cider) {
      property.type = '$cider';
    } else if (value === NumberOrQuery) {
      property.type = '$numberOrQuery';
    }
    return _.omitBy(property, _.isUndefined);
  }


  // schema-inspector 문법은 array에 들어올 수 있는 타입을 한 개 이상 받을 수 있게 되어있지만
  // 여기서는 가장 첫번째 한 개만 처리하고 있다. 인터페이스 구조상 여러 개도 처리할 수 있지만 단순히 안 한 것 뿐이다.
  // @kson //2016-08-04
  function sanitizeAsArray([item]) {
    const property: SchemaInspectorProperty = {optional: true};
    return parseSanitization(property, item);
  }


  // sanitization은 optional의 기본값이 true
  // https://github.com/Atinux/schema-inspector#s_optional
  // 헷갈리니까 생략하면 기본값, !는 required, ?는 optional로 양쪽에서 동일한 규칙을 쓰도록 한다
  // [example] validate: { a: 1, 'b?': 1, 'c!': 1 } - required / optional / required
  // [example] sanitize: { a: 1, 'b?': 1, 'c!': 1 } - optional / optional / required
  function sanitizeAsObject(obj: {[key: string]: SanitizePropertyTypes}) {
    if (!obj) return;

    const properties: { [key: string]: SchemaInspectorProperty } = {};
    _.each(obj, (value, key) => {
      const property: SchemaInspectorProperty = {optional: true};
      if (key.endsWith('?')) {
        property.optional = true;
        key = key.slice(0, -1);
      } else if (key.endsWith('!')) {
        property.optional = false;
        key = key.slice(0, -1);
      }
      properties[key] = parseSanitization(property, value);
    });
    return properties;
  }


  function isPlainObject(target: SanitizePropertyTypes | {[key: string]: SanitizePropertyTypes}) {
     if (
       target instanceof _Number ||
       target instanceof _String ||
       target instanceof _Object ||
       target instanceof _Array ||
       target === global.Number ||
       target === global.String ||
       target === Boolean ||
       target === ObjectId ||
       target === Cider ||
       target === NumberOrQuery ||
       target === Any
     ) {
       return false;
     }
     return true;
   }



  export function sanitize(target: SanitizePropertyTypes |
                          {[key: string]: SanitizePropertyTypes} |
                          [SanitizePropertyTypes]): any {
    if (global.Array.isArray(target)) {
      return {
        type: 'array',
        items: sanitizeAsArray(target)
      };
      // 여기 내려오면 obj는 배열이 아니니까 [xxx]는 타입 추론에서 제외되어야 하는데 잡아주질 못하고 있다
      // 2.x에는 아마 가능할 것 같은 느낌.  @kson //2016-08-03
    } else if (isPlainObject(target)) {
      return {
        type: 'object',
        properties: sanitizeAsObject(target as { [key: string]: SanitizePropertyTypes })
      };
    }
    return parseSanitization({}, target as SanitizePropertyTypes);
  }


  export const query = makeDecorator<SanitizePropertyTypes>(sanitize, 'sanitization', 'query');
  export const body = makeDecorator<SanitizePropertyTypes>(sanitize, 'sanitization', 'body');
  export const params = makeDecorator<SanitizePropertyTypes>(sanitize, 'sanitization', 'params');
  export const session = makeDecorator<SanitizePropertyTypes>(sanitize, 'sanitization', 'session');
  export const result = makeDecorator<SanitizePropertyTypes>(sanitize, 'sanitization', 'result');
}


export namespace validate {
  export interface _ObjectId { $validate: Symbol; };
  export const ObjectId: _ObjectId = { $validate: Symbol() };
  export interface _Cider { $validate: Symbol; };
  export const Cider: _Cider = { $validate: Symbol() };
  export interface _NumberOrQuery { $validate: Symbol; };
  export const NumberOrQuery: _NumberOrQuery = { $validate: Symbol() };
  export interface _Any { $validate: Symbol; };
  export const Any: _Any = { $validate: Symbol() };

  export interface __Number {
    lt?: number;
    lte?: number;
    gt?: number;
    gte?: number;
    eq?: number | number[];
    ne?: number;
  }


  export class _Number implements __Number {
    lt: number;
    lte: number;
    gt: number;
    gte: number;
    eq: number | number[];
    ne: number;

    constructor ({lt, lte, gt, gte, eq, ne}: __Number) {
      this.lt = lt;
      this.lte = lte;
      this.gt = gt;
      this.gte = gte;
      this.eq = eq;
      this.ne = ne;
    }
  }


  export function Number({lt, lte, gt, gte, eq, ne}: __Number) {
    return new _Number({lt, lte, gt, gte, eq, ne});
  }


  export interface __String {
    exactLength?: number;
    eq?: [string] | string;
    ne?: [string] | string;
  }


  export class _String implements __String {
    exactLength: number;
    eq: [string] | string;
    ne: [string] | string;

    constructor ({ exactLength, eq, ne }: __String) {
      this.exactLength = exactLength;
      this.eq = eq;
      this.ne = ne;
    }
  }


  export function String({exactLength, eq, ne}: __String) {
    return new _String({exactLength, eq, ne});
  }


  export class _Object {
    properties: { [key: string]: ValidatePropertyTypes };

    constructor(obj: { [key: string]: ValidatePropertyTypes }) {
      this.properties = obj;
    }
  }


  export function Object(obj?: { [key: string]: ValidatePropertyTypes }) {
    return new _Object(obj);
  }


  export class _Array {
    items: [ValidatePropertyTypes];

    constructor(items: [ValidatePropertyTypes]) {
      this.items = items;
    }
  }


  export function Array(items?: [ValidatePropertyTypes]) {
    return new _Array(items);
  }


  export type ValidatePropertyTypes =
    typeof global.String | string | _String |
    typeof global.Number | number | _Number |
    typeof Boolean | typeof Date | _Object | _Array | _Any |
    _ObjectId | _Cider | _NumberOrQuery;


  function parseValidation(property: SchemaInspectorProperty, value: ValidatePropertyTypes) {
    if (value === global.String) {
      property.type = 'string';
    } else if (value instanceof _String) {
      property.type = 'string';
      _.merge(property, value);
    } else if (value === global.Number) {
      property.type = 'number';
    } else if (value instanceof _Number) {
      property.type = 'number';
      _.merge(property, value);
    } else if (value === Boolean) {
      property.type = 'boolean';
    } else if (value === Date) {
      property.type = 'date';
    } else if (value instanceof _Object) {
      property.type = 'object';
      property.properties = validateAsObject(value.properties);
    } else if (value instanceof _Array) {
      property.type = 'array';
      property.items = validateAsArray(value.items);
    } else if (value === Any) {
      property.type = 'any';
    } else if (value === ObjectId) {
      property.type = '$oid';
    } else if (value === Cider) {
      property.type = '$cider';
    } else if (value === NumberOrQuery) {
      property.type = '$numberOrQuery';
    }
    return _.omitBy(property, _.isUndefined);
  }


  // schema-inspector 문법은 array에 들어올 수 있는 타입을 한 개 이상 받을 수 있게 되어있지만
  // 여기서는 가장 첫번째 한 개만 처리하고 있다. 인터페이스 구조상 여러 개도 처리할 수 있지만 단순히 안 한 것 뿐이다.
  // @kson //2016-08-04
  function validateAsArray(items?: [ValidatePropertyTypes]) {
    if (!items) return;

    const item = items[0];
    const property: SchemaInspectorProperty = {optional: false};
    return parseValidation(property, item);
  }

  // validation의 optional의 기본값은 false
  // https://github.com/Atinux/schema-inspector#v_optional
  // 헷갈리니까 생략하면 기본값, !는 required, ?는 optional로 양쪽에서 동일한 규칙을 쓰도록 한다
  // [example] validate: { a: 1, 'b?': 1, 'c!': 1 } - required / optional / required
  // [example] sanitize: { a: 1, 'b?': 1, 'c!': 1 } - optional / optional / required
  function validateAsObject(obj?: {[key: string]: ValidatePropertyTypes}) {
    if (!obj) return;

    const properties: { [key: string]: SchemaInspectorProperty } = {};
    _.each(obj, (value, key) => {
      const property: SchemaInspectorProperty = {optional: false};
      if (key.endsWith('?')) {
        property.optional = true;
        key = key.slice(0, -1);
      } else if (key.endsWith('!')) {
        property.optional = false;
        key = key.slice(0, -1);
      }
      properties[key] = parseValidation(property, value);
    });
    return properties;
  }


  function isPlainObject(target: ValidatePropertyTypes | { [key: string]: ValidatePropertyTypes }) {
    if (
      target instanceof _Number ||
      target instanceof _String ||
      target instanceof _Object ||
      target instanceof _Array ||
      target === global.Number ||
      target === global.String ||
      target === Boolean ||
      target === ObjectId ||
      target === Cider ||
      target === NumberOrQuery ||
      target === Any
    ) {
      return false;
    }
    return true;
  }


  export function validate(target: ValidatePropertyTypes |
                          {[key: string]: ValidatePropertyTypes} |
                          [ValidatePropertyTypes]): any {
    if (global.Array.isArray(target)) {
      return {
        type: 'array',
        items: validateAsArray(target)
      };
      // 여기 내려오면 obj는 배열이 아니니까 [ValidatePropertyTypes]는 타입 추론에서 제외되어야 하는데 잡아주질 못하고 있다
      // 2.x에는 아마 가능할 것 같은 느낌.  @kson //2016-08-03
    } else if (isPlainObject(target)) {
      return {
        type: 'object',
        properties: validateAsObject(target as { [key: string]: ValidatePropertyTypes })
      };
    }
    return parseValidation({}, target as ValidatePropertyTypes);
  }


  export const query = makeDecorator<ValidatePropertyTypes>(validate, 'validation', 'query');
  export const body = makeDecorator<ValidatePropertyTypes>(validate, 'validation', 'body');
  export const params = makeDecorator<ValidatePropertyTypes>(validate, 'validation', 'params');
  export const session = makeDecorator<ValidatePropertyTypes>(validate, 'validation', 'session');
  export const result = makeDecorator<ValidatePropertyTypes>(validate, 'validation', 'result');
}


// - EndpointOptions#level 속성의 Syntactic Sugar 이다
// - @endpoint 데코레이터의 옵션에서 레벨을 선언하는 것과 @auth 데코레이터의 효과는 동일하다
// - 선언이 중복될 경우 높은 레벨이 남는다
// - 어떤 순서로 선언되어도 효과는 동일하다
//
// [EXAMPLE]
// @island.auth(10)
// @island.endpoint('...', { level: 10 })
export function auth(level:number) {
  return (target, key, desc: PropertyDescriptor) => {
    const options = desc.value.options = (desc.value.options || {}) as EndpointOptions;
    options.level = Math.max(options.level || 0, level);
    if (desc.value.endpoints) {
      desc.value.endpoints.forEach(e => _.merge(e.options, options));
    }
  };
}

function adminize(name) {
  const [method, uri] = name.split(' ');
  if (uri.startsWith('/v2/admin')) return name;

  const tokens = uri.split('/');
  if (!tokens[0]) tokens.shift();
  if (tokens[0] === 'v2') tokens.shift();
  const newUri = [null, 'v2', 'admin'].concat(tokens).join('/');

  return `${method} ${newUri}`;
}

// - EndpointOptions#level, EndpointOptions#admin 속성의 Syntactic Sugar 이다
//
// [EXAMPLE]
// @island.endpoint('GET /v2/a', {})
// @island.admin
// @island.endpoint('GET /v2/b', {})
export function admin(target, key, desc) {
  const options = desc.value.options = (desc.value.options || {}) as EndpointOptions;
  options.level = Math.max(options.level || 0, 9);
  options.admin = true;
  if (desc.value.endpoints) {
    desc.value.endpoints.forEach(e => {
      e.name = adminize(e.name);
      _.merge(e.options, options);
    });
  }
}

export function devonly(target, key, desc) {
  const options = desc.value.options = (desc.value.options || {}) as EndpointOptions;
  options.developmentOnly = true;
  if (desc.value.endpoints) {
    desc.value.endpoints.forEach(e => {
      _.merge(e.options, options);
    });
  }
}

function mangle(name) {
  return name.replace(' ', '@').replace(/\//g, '|');
}

function pushSafe(object, arrayName, element) {
  const array = object[arrayName] = object[arrayName] || [];
  array.push(element);
}

interface Endpoint {
  name: string;
  options: EndpointOptions;
  handler: (req) => Promise<any>;
}

// - 컨트롤러 메소드 하나에 여러 endpoint를 붙일 수 있다.
//
// [EXAMPLE]
// @island.endpoint('GET /v2/blahblah', { level: 10, developmentOnly: true })
export function endpoint(name: string, endpointOptions?: EndpointOptions) {
  return (target, key, desc: PropertyDescriptor) => {
    const handler = desc.value;
    const options = _.merge({}, handler.options || {}, endpointOptions) as EndpointOptions;
    if (options.admin) {
      name = adminize(name);
    }
    if (!options.hasOwnProperty('level')) {
       if (name.startsWith('GET') || name.startsWith('get')) {
        options.level = 5;
      } else {
        options.level = 7;
      }
    }

    const endpoint = { name, options, handler } as Endpoint;
    pushSafe(handler, 'endpoints', endpoint);

    const constructor = target.constructor;
    pushSafe(constructor, '_endpointMethods', endpoint);
  };
}

export function endpointController(registerer?: {registerEndpoint: (name: string, value: any) => Promise<any>}) {
  return function _endpointControllerDecorator(target) {
    const _onInitialized = target.prototype.onInitialized;
    target.prototype.onInitialized = function () {
      return Promise.all(_.map(target._endpointMethods, (v: Endpoint) => {
        const developmentOnly = _.get(v, 'options.developmentOnly');
        if (developmentOnly && process.env.NODE_ENV !== 'development') return Promise.resolve();

        v.name = mangle(v.name);

        return this.server.register(v.name, v.handler.bind(this)).then(() => {
          return registerer && registerer.registerEndpoint(v.name, v.options || {}) || Promise.resolve();
        });
      }))
        .then(() => _onInitialized.apply(this));
    };

    const _onDestroy = target.prototype.onDestroy;
    target.prototype.onDestroy = function () {
      return Promise.all(_.map(target._endpointMethods, (v: Endpoint) => {
        logger.info(`stop serving ${v.name}`);
        return this.server.unregister(v.name);
      }))
        .then(() => _onDestroy.apply(this));
    };
  };
}
