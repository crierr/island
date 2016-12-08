import * as _ from 'lodash';
import * as Promise from 'bluebird';
import { Di } from './di';
import PushService from '../services/push-service';

export class ResourcePush {
  private resourceTargets: {[id: string]: ResourceTarget} = {};

  constructor(@Di.inject private pushService: PushService) {
  }

  target(id: string): ResourceTarget {
    let target = this.resourceTargets[id];
    if (!target) {
      target = new ResourceTarget(id, this.pushService);
      this.resourceTargets[id] = target;
    }
    return target;
  }

  disposer(): Promise.Disposer<any> {
    return Promise.resolve().disposer(async (result, promise) => {
      if (!promise.isFulfilled()) return;
      for (let target of _.map(this.resourceTargets, i => i)) {
        await target.flush();
      }
    });
  }
}

export interface ResourceChange {
  uri: string;
  body?: any;
  delete?: boolean;
}

export class ResourcePath {
  constructor(protected fullPath: string,
              protected changes: ResourceChange[]) {
  }

  path(path: string): ResourceModifier {
    return new ResourceModifier(`${this.fullPath}/${path}`, this.changes);
  }

  all(path: string): ResourceModifier {
    return this.path(path);
  }

  one(path: string, id: string): ResourceModifier {
    return this.path(`${path}/${id}`);
  }
}

export class ResourceModifier extends ResourcePath {
  constructor(fullPath: string,
              changes: ResourceChange[]) {
    super(fullPath, changes);
  }

  set(body: any): void {
    this.changes.push({uri: this.fullPath, body});
  }

  remove(): void {
    this.changes.push({uri: this.fullPath, delete: true});
  }

  add(body: {id: string}): void {
    return this.path(body.id).set(body);
  }
}

export class ResourceTarget extends ResourcePath {
  constructor(private target: string,
              private pushService: PushService) {
    super('', []);
  }

  async flush(): Promise<any> {
    return this.pushService.unicast(this.target, {cmd: 'resources', opts: this.changes});
  }
}
