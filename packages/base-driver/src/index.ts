import {
  IConnectionDriver,
  IBaseQueries,
  IConnection,
  IDatabaseFilter,
  IExpectedResult,
  NodeDependency,
  ContextValue,
  MConnectionExplorer,
  IQueryOptions,
  NSDatabase,
} from '@sqltools/types';
import ElectronNotSupportedError from './lib/exception/electron-not-supported';
import MissingModuleError from './lib/exception/missing-module';
import sqltoolsRequire from './lib/require';
import log from './lib/log';

export default abstract class AbstractDriver<ConnectionType extends any, DriverOptions extends any> implements IConnectionDriver {
  public log: typeof log;
  public readonly deps: NodeDependency[] = [];

  public getId() {
    return this.credentials.id;
  }
  public connection: Promise<ConnectionType>;
  abstract queries: IBaseQueries;
  constructor(public credentials: IConnection<DriverOptions>) {
    this.log = log.extend(credentials.driver.toLowerCase());
  }

  abstract open(): Promise<ConnectionType>;
  abstract close(): Promise<void>;

  abstract query<R = any, Q = any>(queryOrQueries: Q | string | String, opt: IQueryOptions): Promise<NSDatabase.IResult<Q extends IExpectedResult<infer U> ? U : R>[]>;

  public singleQuery<R = any, Q = any>(query: Q | string | String, opt: IQueryOptions) {
    return this.query<R, Q>(query, opt).then(([ res ]) => res);
  }

  protected queryResults = async <R = any, Q = any>(query: Q | string | String, opt?: IQueryOptions) => {
    const result = await this.singleQuery<R, Q>(query, opt);
    if (result.error) throw result.rawError;
    return result.results;
  }

  public async describeTable(metadata: NSDatabase.ITable, opt: IQueryOptions) {
    const result = await this.singleQuery(this.queries.describeTable(metadata), opt);
    result.baseQuery = this.queries.describeTable.raw;
    return [result];
  }

  public async showRecords(table: NSDatabase.ITable, opt: IQueryOptions & { limit: number, page?: number }) {
    const { limit, page = 0} = opt;
    const params = { limit, table, offset: page * limit };
    if (typeof this.queries.fetchRecords === 'function' && typeof this.queries.countRecords === 'function') {
      const [ records, totalResult ] = await (Promise.all([
        this.singleQuery(this.queries.fetchRecords(params), opt),
        this.singleQuery(this.queries.countRecords(params), opt),
      ]));
      records.baseQuery = this.queries.fetchRecords.raw;
      records.pageSize = limit;
      records.page = page;
      records.total = Number((totalResult.results[0] as any).total);
      records.queryType = 'showRecords';
      records.queryParams = table;
      return [records];
    }

    return this.query(this.queries.fetchRecords(params), opt);
  }

  protected needToInstallDependencies() {
    if (parseInt(process.env.IS_NODE_RUNTIME || '0') !== 1) {
      throw new ElectronNotSupportedError();
    }
    if (this.deps && this.deps.length > 0) {
      this.deps.forEach(dep => {
        let mustUpgrade = false;
        switch (dep.type) {
          case AbstractDriver.CONSTANTS.DEPENDENCY_PACKAGE:
            try {
              delete sqltoolsRequire.cache[sqltoolsRequire.resolve(dep.name + '/package.json')];
              const { version } = sqltoolsRequire(dep.name + '/package.json');
              if (dep.version && version !== dep.version) {
                mustUpgrade = true;
                throw new Error(`Version not matching. We need to upgrade ${dep.name}`);
              }
              sqltoolsRequire(dep.name);
            } catch(e) {
              throw new MissingModuleError(this.deps, this.credentials, mustUpgrade);
            }
            break;
        }
      });
    }
    return false
  }

  public getBaseQueryFilters() {
    const databaseFilter: IDatabaseFilter = this.credentials.databaseFilter || <IDatabaseFilter>{};
    databaseFilter.show = databaseFilter.show || (!databaseFilter.hide ? [this.credentials.database] : []);
    databaseFilter.hide = databaseFilter.hide || [];

    return {
      databaseFilter
    };
  }

  public getChildrenForItem(_params: { item: NSDatabase.SearchableItem; parent?: NSDatabase.SearchableItem }): Promise<MConnectionExplorer.IChildItem[]> {
    this.log.extend('error')(`###### Attention ######\getChildrenForItem not implemented for ${this.credentials.driver}\n####################`);
    return Promise.resolve([]);
  }
  public searchItems(_itemType: ContextValue, _search: string, _extraParams?: any): Promise<NSDatabase.SearchableItem[]> {
    this.log.extend('error')(`###### Attention ######\searchItems not implemented for ${this.credentials.driver}\n####################`);
    return Promise.resolve([]);
  }

  protected prepareMessage(message: any): NSDatabase.IResult['messages'][number] {
    return { message: message.toString(), date: new Date() };
  }

  static readonly CONSTANTS = {
    DEPENDENCY_PACKAGE: 'package' as NodeDependency['type'],
    DEPENDENCY_NPM_SCRIPT: 'npmscript' as NodeDependency['type'],
  }
}