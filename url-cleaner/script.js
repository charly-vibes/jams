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

document.addEventListener('DOMContentLoaded', async () => {
    const urlInput = document.getElementById('url-input');
    const urlOutput = document.getElementById('url-output');
    const copyBtn = document.getElementById('copy-btn');
    const copyFeedback = document.getElementById('copy-feedback');
    const pasteBtn = document.getElementById('paste-btn');
    const removedParamsSection = document.getElementById('removed-params-section');
    const removedParamsTableBody = document.querySelector('#removed-params-table tbody');

    // Function to render the removed parameters table
    const renderRemovedParams = (removed) => {
        removedParamsTableBody.innerHTML = '';
        
        if (removed.length === 0) {
            removedParamsSection.classList.add('hidden');
            return;
        }

        removed.forEach(({ key, value }) => {
            const row = document.createElement('tr');
            
            const keyCell = document.createElement('td');
            keyCell.textContent = key;
            
            const valueCell = document.createElement('td');
            valueCell.textContent = value;
            
            row.appendChild(keyCell);
            row.appendChild(valueCell);
            removedParamsTableBody.appendChild(row);
        });

        removedParamsSection.classList.remove('hidden');
    };

    // Function to update the output based on input
    const updateOutput = () => {
        const inputValue = urlInput.value.trim();

        if (!inputValue) {
            urlOutput.value = '';
            copyBtn.disabled = true;
            copyFeedback.textContent = '';
            renderRemovedParams([]);
            return false;
        }

        try {
            const { cleanedUrl, removedParams } = cleanUrl(inputValue);
            urlOutput.value = cleanedUrl;
            copyBtn.disabled = false;
            copyFeedback.textContent = '';
            renderRemovedParams(removedParams);
            return true;
        } catch (error) {
            urlOutput.value = 'Invalid URL';
            copyBtn.disabled = true;
            copyFeedback.textContent = '';
            renderRemovedParams([]);
            return false;
        }
    };

    // Check for 'c' query parameter first
    // We handle this manually to support unencoded URLs that might contain '&'
    // which would otherwise be split by URLSearchParams
    const getParamValue = () => {
        const search = window.location.search;
        const paramMatch = search.match(/[?&]c=(.*)/);
        if (paramMatch) {
            const rawValue = paramMatch[1];
            try {
                return decodeURIComponent(rawValue);
            } catch (e) {
                // If decoding fails (e.g. invalid % sequences), use raw value
                return rawValue;
            }
        }
        return null;
    };

    const urlToClean = getParamValue();

    if (urlToClean) {
        urlInput.value = urlToClean;
        const isValid = updateOutput();
        if (isValid) {
            try {
                await navigator.clipboard.writeText(urlOutput.value);
                copyFeedback.textContent = 'Cleaned URL from parameter copied to clipboard!';
                setTimeout(() => {
                    copyFeedback.textContent = '';
                }, 3000);
            } catch (err) {
                console.error('Failed to copy param URL:', err);
                copyFeedback.textContent = 'URL cleaned, but failed to copy automatically.';
            }
        }
    } else {
        // Fallback: Auto-paste on load if no param
        try {
            const text = await navigator.clipboard.readText();
            if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
                urlInput.value = text;
                updateOutput();
            }
        } catch (err) {
            // Silently fail if permission denied or empty
            console.log('Auto-paste failed:', err);
        }
    }

    urlInput.addEventListener('input', updateOutput);

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                urlInput.value = text;
                const isValid = updateOutput();
                
                if (isValid) {
                    await navigator.clipboard.writeText(urlOutput.value);
                    
                    // Show feedback on the paste button
                    const originalText = pasteBtn.textContent;
                    pasteBtn.textContent = 'Cleaned & Copied!';
                    pasteBtn.style.backgroundColor = '#000'; // distinct feedback state
                    
                    setTimeout(() => {
                        pasteBtn.textContent = originalText;
                        pasteBtn.style.backgroundColor = ''; // revert
                    }, 2000);
                }
            }
        } catch (err) {
            console.error('Paste failed:', err);
            pasteBtn.textContent = 'Failed';
            setTimeout(() => {
                pasteBtn.textContent = 'Paste & Copy Cleaned';
            }, 2000);
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
    const removedParams = [];

    TRACKING_PARAMS.forEach(param => {
        if (params.has(param)) {
            removedParams.push({
                key: param,
                value: params.get(param)
            });
            params.delete(param);
        }
    });

    const cleanedParams = params.toString();
    url.search = cleanedParams ? '?' + cleanedParams : '';

    return {
        cleanedUrl: url.toString(),
        removedParams: removedParams
    };
}