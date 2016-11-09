import * as _ from 'lodash';
import * as fs from 'fs';
import * as Promise from 'bluebird';

import { IAbstractAdapter } from './adapters/abstract-adapter';
import ListenableAdapter, { IListenableAdapter } from './adapters/listenable-adapter';
import { logger } from './utils/logger';
import { bindImpliedServices } from './utils/di-bind';
import { LogicError, FatalError, ISLAND } from './utils/error';

/**
 * Create a new Islet.
 * @abstract
 * @class
 */
export default class Islet {
  private static islet: Islet;

  /**
   * Register the islet which is the suite of micro-service
   * @param {Islet} islet
   * @static
   */
  private static registerIslet(islet: Islet) {
    if (Islet.islet) throw new FatalError(ISLAND.FATAL.F0001_ISLET_ALREADY_HAS_BEEN_REGISTERED, 'The islet already has been registered.');
    Islet.islet = islet;
  }

  /**
   * Retrieves a registered micro-service.
   * @returns {Microservice}
   * @static
   */
  static getIslet(): Islet {
    return Islet.islet;
  }

  /**
   * Instantiate and run a microservice.
   * @param {Microservice} Class
   * @static
   */
  public static run(Class: typeof Islet) {
    if (this.islet) return;

    // Create such a micro-service instance.
    let islet = new Class();
    this.registerIslet(islet);

    islet.main();
    return islet.initialize();
  }

  /** @type {Object.<string, IAbstractAdapter>} [adapters={}] */
  private adapters: { [name: string]: IAbstractAdapter; } = {};

  /**
   * Register the adapter.
   * @param {string} name
   * @param {IAbstractAdapter} adapter
   */
  public registerAdapter(name: string, adapter: IAbstractAdapter) {
    if (this.adapters[name]) throw new FatalError(ISLAND.FATAL.F0002_DUPLICATED_ADAPTER, 'duplicated adapter');
    this.adapters[name] = adapter;
  }

  /**
   * @param {string} name
   * @returns {typeof Adapter}
   */
  public getAdaptee<T>(name: string): T {
    if (!this.adapters[name]) throw new FatalError(ISLAND.FATAL.F0003_MISSING_ADAPTER, 'Missing adapter');
    return this.adapters[name].adaptee as T;
  }

  /**
   * @abstract
   */
  public main() {
    throw new FatalError(ISLAND.FATAL.F0004_NOT_IMPLEMENTED_ERROR, 'Not implemented exception.');
  }

  /**
   * @returns {Promise<void>}
   */
  private initialize() {
    return Promise.all(_.values<IAbstractAdapter>(this.adapters).map(adapter => adapter.initialize()))
      .then(() => process.once('SIGTERM', this.destroy.bind(this)))
      .then(() => bindImpliedServices(this.adapters))
      .then(() => Promise.resolve(this.onInitialized()))
      .then(() => _.values<IListenableAdapter>(this.adapters).filter(adapter => adapter instanceof ListenableAdapter))
      .then(adapters => {
        return Promise.all(adapters.map(adapter => adapter.postInitialize()))
          .then(() => Promise.all(adapters.map(adapter => adapter.listen())));
      })
      .then(() => logger.info('started'))
      .then(() => this.onStarted())
      .catch(e => {
        console.log('failed to initialize', e);
        process.exit(1);
      });
  }

  protected onInitialized() {}
  protected onDestroy() {}
  protected onStarted() {}

  private destroy() {
    logger.info('Waiting for process to end');
    return Promise.all(_.values<IAbstractAdapter>(this.adapters).map(adapter => adapter.destroy()))
      .then(() => this.onDestroy());
  }
}
