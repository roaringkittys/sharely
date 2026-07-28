// Cross-browser WebExtension surface. Do not assume MV3 or Chrome globals.
const browserAPI = globalThis.browser || globalThis.chrome;

function hasApi(path) {
  return path.split('.').reduce((value, part) => value && value[part], browserAPI) != null;
}

function unavailable(name) {
  return Promise.reject(new Error(`${name} API is unavailable in this browser.`));
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
  storageGet(keys) {
    return hasApi('storage.local.get')
      ? callApi(browserAPI.storage.local.get, browserAPI.storage.local, [keys])
      : unavailable('storage');
  },
  storageSet(values) {
    return hasApi('storage.local.set')
      ? callApi(browserAPI.storage.local.set, browserAPI.storage.local, [values])
      : unavailable('storage');
  },
  cookiesGetAll(details) {
    return hasApi('cookies.getAll')
      ? callApi(browserAPI.cookies.getAll, browserAPI.cookies, [details])
      : unavailable('cookies.getAll');
  },
  cookiesSet(details) {
    return hasApi('cookies.set')
      ? callApi(browserAPI.cookies.set, browserAPI.cookies, [details])
      : unavailable('cookies.set');
  },
  cookiesRemove(details) {
    return hasApi('cookies.remove')
      ? callApi(browserAPI.cookies.remove, browserAPI.cookies, [details])
      : unavailable('cookies.remove');
  },
  tabsCreate(details) {
    return hasApi('tabs.create')
      ? callApi(browserAPI.tabs.create, browserAPI.tabs, [details])
      : unavailable('tabs.create');
  },
};