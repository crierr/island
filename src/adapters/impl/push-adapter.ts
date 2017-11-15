import { map } from 'lodash';
import { AmqpChannelPoolService } from '../../services/amqp-channel-pool-service';
import PushService from '../../services/push-service';
import { FatalError, ISLAND } from '../../utils/error';
import ListenableAdapter from '../listenable-adapter';
import { AmqpChannelPoolAdapter } from './amqp-channel-pool-adapter';

export interface PushAdapterOptions {
  urls: string[];
  poolSize?: number;
  prefetchCount?: number;
  amqpChannelPoolAdapter?: AmqpChannelPoolAdapter;
}

export default class PushAdapter extends ListenableAdapter<PushService, PushAdapterOptions> {
  async initialize(): Promise<void> {
    if (!this.options) throw new FatalError(ISLAND.FATAL.F0025_MISSING_ADAPTER_OPTIONS);
    const { urls, poolSize, prefetchCount, amqpChannelPoolAdapter } = this.options;
    let channelPools: AmqpChannelPoolService[];
    if (!amqpChannelPoolAdapter) {
      channelPools = await Promise.all(map(urls, async url => {
        const pool = new AmqpChannelPoolService();
        await pool.initialize({ url, poolSize, prefetchCount });
        await pool.waitForInit();
        return pool;
      }));
    } else {
      const channelPoolService = amqpChannelPoolAdapter.adaptee;
      await channelPoolService.waitForInit();
      channelPools = [channelPoolService];
    }
    this._adaptee = new PushService();
    return this._adaptee.initialize(channelPools);
  }

  listen(): Promise<void> {
    return Promise.resolve();
  }

  async destroy(): Promise<any> {
    await super.destroy();
    return this.adaptee.purge();
  }
}
