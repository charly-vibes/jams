// URL Cleaner functionality

const TRACKING_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'fbclid',
    'gclid',
    'mc_eid',
    'ref',
    '_ga'
];

document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    const urlOutput = document.getElementById('url-output');
    const copyBtn = document.getElementById('copy-btn');
    const copyFeedback = document.getElementById('copy-feedback');

    urlInput.addEventListener('input', () => {
        const inputValue = urlInput.value.trim();

        if (!inputValue) {
            urlOutput.value = '';
            copyBtn.disabled = true;
            copyFeedback.textContent = '';
            return;
        }

        try {
            const cleanedUrl = cleanUrl(inputValue);
            urlOutput.value = cleanedUrl;
            copyBtn.disabled = false;
            copyFeedback.textContent = '';
        } catch (error) {
            urlOutput.value = 'Invalid URL';
            copyBtn.disabled = true;
            copyFeedback.textContent = '';
        }
    });

    copyBtn.addEventListener('click', () => {
        const textToCopy = urlOutput.value;

        navigator.clipboard.writeText(textToCopy).then(() => {
            copyFeedback.textContent = 'Copied!';
            setTimeout(() => {
                copyFeedback.textContent = '';
            }, 2000);
        }).catch(() => {
            copyFeedback.textContent = 'Failed to copy';
        });
    });
});

function cleanUrl(urlString) {
    const url = new URL(urlString);
    const params = new URLSearchParams(url.search);

    TRACKING_PARAMS.forEach(param => {
        params.delete(param);
    });

    const cleanedParams = params.toString();
    url.search = cleanedParams ? '?' + cleanedParams : '';

    return url.toString();
}
