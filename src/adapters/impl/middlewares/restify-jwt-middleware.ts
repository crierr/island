import restify = require('restify');
import jwt = require('jsonwebtoken');

export interface IToken {
  sid: string;
  aid?: string;
  aname?: string;
  publisher: string;
}

/**
 * Check the HTTP authorization header, then parse only if the header is a bearer JWT token.
 * @param {{secret: string}} options
 * @return {RequestHandler}
 */
export default function jwtParser(options: { secret: string }): restify.RequestHandler {
  return function (req: restify.Request, res: restify.Response, next: restify.Next) {
    /**
     * Authorization field of the request header examples
     *
     *  GET /auth/ HTTP/1.1
     *  Host: www.example.com
     *  Authorization: Basic aHR0cHdhdGNoOmY=
     */
    var header: string = req.headers['authorization'];
    if (!header) return next();

    var parts = header.split(' ');
    if (!parts || parts.length !== 2) {
      console.log('[RESTIFY] invalid auth header', parts);
      return next(new restify.InvalidHeaderError('Invalid Authorization header'));
    }

    var scheme = parts[0];
    var credentials = parts[1];
    if (/^Bearer$/i.test(scheme)) {
      jwt.verify(credentials, options.secret,(err, decode) => {
        if (err) return next();
        req['token'] = typeof decode === 'string' ? JSON.parse(decode) : decode;
        next();
      });
    } else {
      next();
    }
  };
}
