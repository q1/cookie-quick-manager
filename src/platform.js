/*
 *  Cookie Quick Manager: A Chromium/Firefox compatibility helper module.
 */
'use strict';

(function(self) {

if (self.vAPI === undefined) {
    self.vAPI = {};
}

var vAPI = self.vAPI;

vAPI.isFirefox = typeof browser.runtime.getBrowserInfo === "function";
vAPI.isIncognitoContext = browser.extension.inIncognitoContext === true;
vAPI.supportsContextualIdentities = typeof browser.contextualIdentities?.query === "function";
vAPI.supportsFirstPartyIsolation = typeof browser.privacy?.websites?.firstPartyIsolate?.get === "function";

vAPI.default_stores = vAPI.isFirefox ? [
    {
        name: browser.i18n.getMessage("container_default"),
        icon: "circle",
        iconUrl: "",
        color: "black",
        colorCode: "#555555",
        cookieStoreId: "firefox-default",
    },
    {
        name: browser.i18n.getMessage("container_private"),
        icon: "private-browsing",
        iconUrl: "icons/private-browsing.svg",
        color: "purple",
        colorCode: "#af51f5",
        cookieStoreId: "firefox-private",
    },
] : [
    {
        name: browser.i18n.getMessage("container_default"),
        icon: "circle",
        iconUrl: "",
        color: "black",
        colorCode: "#555555",
        cookieStoreId: "0",
    },
    {
        name: browser.i18n.getMessage("container_private"),
        icon: "private-browsing",
        iconUrl: "icons/private-browsing.svg",
        color: "purple",
        colorCode: "#af51f5",
        cookieStoreId: "1",
    },
];

vAPI.defaultStoreId = function() {
    return vAPI.default_stores[0].cookieStoreId;
}

vAPI.privateStoreId = function() {
    return vAPI.default_stores[1].cookieStoreId;
}

vAPI.isDefaultStoreId = function(storeId) {
    return storeId === vAPI.defaultStoreId();
}

vAPI.isPrivateStoreId = function(storeId) {
    return storeId === vAPI.privateStoreId();
}

vAPI.getTabCookieStoreId = function(tabId) {
    // Return the cookie store id associated with the given tab id.
    // Chromium tabs do not expose cookieStoreId directly.
    return browser.cookies.getAllCookieStores()
    .then((stores) => {
        for (let store of stores) {
            if (store.tabIds.includes(tabId))
                return store.id;
        }

        return vAPI.defaultStoreId();
    });
}

})(globalThis);
