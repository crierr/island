import * as _ from 'lodash';
import * as amqp from 'amqplib';
import * as Promise from 'bluebird';
import { logger } from '../utils/logger';
import * as util from 'util';

export interface AmqpOptions {
  url: string;
  socketOptions?: {noDelay?: boolean, heartbeat?: number};
  poolSize?: number;
}

export interface ChannelInfo {
  channel: amqp.Channel;
  date: number;
}

export class AmqpChannelPoolService {
  static DEFAULT_POOL_SIZE: number = 100;

  private connection: amqp.Connection;
  private options: AmqpOptions;
  private openChannels: amqp.Channel[] = [];
  private idleChannels: ChannelInfo[] = [];
  private initResolver: Promise.Resolver<void>;

  constructor() {
    this.initResolver = Promise.defer<void>();
  }

  initialize(options: AmqpOptions): Promise<void> {
    options.poolSize = options.poolSize || AmqpChannelPoolService.DEFAULT_POOL_SIZE;
    this.options = options;
    logger.info(`connecting to broker ${util.inspect(options, {colors: true})}`);
    Promise.resolve(amqp.connect(options.url, options.socketOptions))
      .then(connection => {
        logger.info(`connected to ${options.url}`);
        this.connection = connection;
        this.initResolver.resolve();
      })
      .catch(e => this.initResolver.reject(e));

    return this.initResolver.promise;
  }

  waitForInit(): Promise<void> {
    return this.initResolver.promise;
  }

  purge(): Promise<void> {
    return Promise.resolve(this.connection.close());
  }

  async acquireChannel(): Promise<amqp.Channel> {
    if (this.idleChannels.length) {
      return this.idleChannels.shift().channel;
    }
    return this.createChannel();
  }

  async releaseChannel(channel: amqp.Channel, reusable: boolean = false): Promise<void> {
    if (!_.includes(this.openChannels, channel)) {
      return;
    }
    if (reusable && this.idleChannels.length < this.options.poolSize) {
      this.idleChannels.push({channel:channel, date: +new Date()});
      return;
    }
    return channel.close();
  }

  usingChannel<T>(task: (channel: amqp.Channel) => PromiseLike<T>): Promise<T> {
    return Promise.using(this.getChannelDisposer(), task);
  }

  getChannelDisposer(): Promise.Disposer<amqp.Channel> {
    return this.acquireChannel()
      .disposer((channel: amqp.Channel, promise: Promise<any>) => {
        return this.releaseChannel(channel, promise.isFulfilled());
      });
  }

  private createChannel(): Promise<amqp.Channel> {
    return Promise.resolve(this.connection.createChannel())
      .then(channel => {
        this.setChannelEventHandler(channel);
        this.openChannels.push(channel);
        return channel;
      });
  }

  private setChannelEventHandler(channel: amqp.Channel) {
    channel
      .on('error', err => {
        logger.notice('amqp channel error:', err);
        err.stack && logger.debug(err.stack);
      })
      .on('close', () => {
        _.remove(this.idleChannels, (cur: ChannelInfo) => {
          return cur.channel == channel;
        });
        _.pull(this.openChannels, channel);
      });
  }
}

