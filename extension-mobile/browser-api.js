// Cross-browser WebExtension surface. Do not assume MV3 or Chrome globals.
const browserAPI = globalThis.browser || globalThis.chrome;

function hasApi(path) {
  return path.split('.').reduce((value, part) => value && value[part], browserAPI) != null;
}

function callApi(fn, context, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    try {
      const result = fn.apply(context, [...args, value => {
        const lastError = browserAPI?.runtime?.lastError;
        finish(lastError || null, value);
      }]);
      if (result && typeof result.then === 'function') {
        result.then(value => finish(null, value), error => finish(error));
      } else if (result !== undefined && fn.length <= args.length) {
        finish(null, result);
      }
    } catch (error) {
      finish(error);
    }
  });
}

const api = {
  available: Boolean(browserAPI),
  hasApi,
  storageGet(keys) { return callApi(browserAPI.storage.local.get, browserAPI.storage.local, [keys]); },
  storageSet(values) { return callApi(browserAPI.storage.local.set, browserAPI.storage.local, [values]); },
  cookiesGetAll(details) { return callApi(browserAPI.cookies.getAll, browserAPI.cookies, [details]); },
  cookiesSet(details) { return callApi(browserAPI.cookies.set, browserAPI.cookies, [details]); },
  cookiesRemove(details) { return callApi(browserAPI.cookies.remove, browserAPI.cookies, [details]); },
  tabsCreate(details) { return callApi(browserAPI.tabs.create, browserAPI.tabs, [details]); },
};