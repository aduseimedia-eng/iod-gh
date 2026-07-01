(function () {
    const DEFAULT_API_BASE_URL = '';

    function cleanBaseUrl(value) {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    const meta = document.querySelector('meta[name="iod-api-base"]');
    const configuredBaseUrl = cleanBaseUrl(
        window.IOD_API_BASE_URL ||
        (meta && meta.content) ||
        localStorage.getItem('IOD_API_BASE_URL') ||
        DEFAULT_API_BASE_URL
    );

    window.IOD_API_BASE_URL = configuredBaseUrl;

    window.apiUrl = function apiUrl(path) {
        const rawPath = String(path || '');
        if (/^https?:\/\//i.test(rawPath)) return rawPath;
        if (configuredBaseUrl && rawPath.startsWith('/api/')) {
            return configuredBaseUrl + rawPath;
        }
        return rawPath;
    };

    window.appUrl = function appUrl(path) {
        const cleanPath = String(path || '').replace(/^\/+/, '');
        const isGitHubPages = window.location.hostname.endsWith('github.io');
        const basePath = isGitHubPages ? '/iod-gh/' : '/';
        return basePath + cleanPath;
    };

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function iodFetch(input, init) {
        let nextInput = input;
        const nextInit = Object.assign({}, init || {});
        const inputUrl = typeof input === 'string' ? input : (input && input.url) || '';
        const shouldRewriteApi = String(inputUrl).startsWith('/api/');

        if (shouldRewriteApi) {
            nextInput = typeof input === 'string'
                ? window.apiUrl(input)
                : new Request(window.apiUrl(input.url), input);
            nextInit.credentials = nextInit.credentials || 'include';
        }

        return nativeFetch(nextInput, nextInit);
    };
})();
