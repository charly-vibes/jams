// IP Info functionality

let currentIpInfo = null;

document.addEventListener('DOMContentLoaded', () => {
    const infoContainer = document.getElementById('info-container');
    const copyAllBtn = document.getElementById('copy-all-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const copyFeedback = document.getElementById('copy-feedback');

    loadIpInfo();

    refreshBtn.addEventListener('click', () => {
        loadIpInfo();
    });

    copyAllBtn.addEventListener('click', () => {
        if (!currentIpInfo) return;

        const text = formatIpInfoAsText(currentIpInfo);
        navigator.clipboard.writeText(text).then(() => {
            copyFeedback.textContent = 'Copied!';
            setTimeout(() => {
                copyFeedback.textContent = '';
            }, 2000);
        }).catch(() => {
            copyFeedback.textContent = 'Failed to copy';
        });
    });
});

async function loadIpInfo() {
    const infoContainer = document.getElementById('info-container');
    infoContainer.innerHTML = '<p class="loading">Loading IP information...</p>';

    try {
        const ipInfo = await fetchIpInfo();
        currentIpInfo = ipInfo;
        displayIpInfo(ipInfo, infoContainer);
    } catch (error) {
        infoContainer.innerHTML = '<p class="error">Failed to load IP information. Please try again later.</p>';
        console.error('Error fetching IP info:', error);
    }
}

async function fetchIpInfo() {
    try {
        return await fetchFromIpApiCo();
    } catch (httpsError) {
        console.warn('HTTPS API failed, trying HTTP fallback:', httpsError);
        try {
            return await fetchFromIpApi();
        } catch (httpError) {
            console.error('Both APIs failed:', httpError);
            throw new Error('Failed to fetch IP information from all sources');
        }
    }
}

async function fetchFromIpApiCo() {
    const API_URL = 'https://ipapi.co/json/';
    const response = await fetch(API_URL);

    if (!response.ok) {
        throw new Error('HTTPS API request failed');
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.reason || 'HTTPS API returned error');
    }

    return {
        query: data.ip,
        continent: data.continent_code,
        country: data.country_name,
        countryCode: data.country_code,
        region: data.region_code,
        regionName: data.region,
        city: data.city,
        district: null,
        zip: data.postal,
        lat: data.latitude,
        lon: data.longitude,
        timezone: data.timezone,
        offset: data.utc_offset ? parseUtcOffset(data.utc_offset) : undefined,
        currency: data.currency,
        isp: data.org,
        org: data.org,
        as: data.asn,
        asname: data.org,
        reverse: null,
        mobile: false,
        proxy: false,
        hosting: false
    };
}

async function fetchFromIpApi() {
    const API_URL = 'http://ip-api.com/json/?fields=status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query';
    const response = await fetch(API_URL);

    if (!response.ok) {
        throw new Error('HTTP API request failed');
    }

    const data = await response.json();

    if (data.status === 'fail') {
        throw new Error(data.message || 'HTTP API returned error');
    }

    return data;
}

function parseUtcOffset(offsetString) {
    const match = offsetString.match(/([+-])(\d{2})(\d{2})/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2]);
    const minutes = parseInt(match[3]);
    return sign * (hours * 3600 + minutes * 60);
}

function displayIpInfo(info, container) {
    container.innerHTML = '';

    const sections = [
        {
            title: 'IP Address',
            data: {
                'IP Address': info.query || 'N/A',
                'Reverse DNS': info.reverse || 'N/A'
            }
        },
        {
            title: 'Geolocation',
            data: {
                'Continent': info.continent || 'N/A',
                'Country': info.country ? `${info.country} (${info.countryCode})` : 'N/A',
                'Region': info.regionName ? `${info.regionName} (${info.region})` : 'N/A',
                'City': info.city || 'N/A',
                'District': info.district || 'N/A',
                'Postal Code': info.zip || 'N/A',
                'Coordinates': info.lat && info.lon ? `${info.lat}, ${info.lon}` : 'N/A',
                'Map': info.lat && info.lon ? `View on Map` : 'N/A'
            }
        },
        {
            title: 'ISP Information',
            data: {
                'ISP': info.isp || 'N/A',
                'Organization': info.org || 'N/A',
                'AS': info.as || 'N/A',
                'AS Name': info.asname || 'N/A'
            }
        },
        {
            title: 'Network Details',
            data: {
                'Timezone': info.timezone || 'N/A',
                'UTC Offset': info.offset !== undefined ? `${info.offset / 3600} hours` : 'N/A',
                'Currency': info.currency || 'N/A',
                'Mobile Network': info.mobile ? 'Yes' : 'No',
                'Proxy/VPN': info.proxy ? 'Yes' : 'No',
                'Hosting/Datacenter': info.hosting ? 'Yes' : 'No'
            }
        }
    ];

    sections.forEach(section => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'info-section';

        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = section.title;
        sectionDiv.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'info-grid';

        Object.entries(section.data).forEach(([key, value]) => {
            const label = document.createElement('div');
            label.className = 'info-label';
            label.textContent = key + ':';

            const valueDiv = document.createElement('div');
            valueDiv.className = 'info-value';

            if (value === 'N/A') {
                valueDiv.classList.add('not-available');
                valueDiv.textContent = value;
            } else if (key === 'IP Address') {
                valueDiv.classList.add('ip-highlight');
                valueDiv.textContent = value;
            } else if (key === 'Map' && value !== 'N/A') {
                const link = document.createElement('a');
                link.href = `https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}&zoom=12`;
                link.target = '_blank';
                link.textContent = value;
                valueDiv.appendChild(link);
            } else if (key === 'Coordinates' || key === 'AS') {
                valueDiv.classList.add('monospace');
                valueDiv.textContent = value;
            } else {
                valueDiv.textContent = value;
            }

            grid.appendChild(label);
            grid.appendChild(valueDiv);
        });

        sectionDiv.appendChild(grid);
        container.appendChild(sectionDiv);
    });
}

function formatIpInfoAsText(info) {
    let text = 'IP INFORMATION\n\n';

    text += 'IP ADDRESS\n';
    text += '==========\n';
    text += `IP Address: ${info.query || 'N/A'}\n`;
    text += `Reverse DNS: ${info.reverse || 'N/A'}\n\n`;

    text += 'GEOLOCATION\n';
    text += '===========\n';
    text += `Continent: ${info.continent || 'N/A'}\n`;
    text += `Country: ${info.country ? `${info.country} (${info.countryCode})` : 'N/A'}\n`;
    text += `Region: ${info.regionName ? `${info.regionName} (${info.region})` : 'N/A'}\n`;
    text += `City: ${info.city || 'N/A'}\n`;
    text += `District: ${info.district || 'N/A'}\n`;
    text += `Postal Code: ${info.zip || 'N/A'}\n`;
    text += `Coordinates: ${info.lat && info.lon ? `${info.lat}, ${info.lon}` : 'N/A'}\n\n`;

    text += 'ISP INFORMATION\n';
    text += '===============\n';
    text += `ISP: ${info.isp || 'N/A'}\n`;
    text += `Organization: ${info.org || 'N/A'}\n`;
    text += `AS: ${info.as || 'N/A'}\n`;
    text += `AS Name: ${info.asname || 'N/A'}\n\n`;

    text += 'NETWORK DETAILS\n';
    text += '===============\n';
    text += `Timezone: ${info.timezone || 'N/A'}\n`;
    text += `UTC Offset: ${info.offset !== undefined ? `${info.offset / 3600} hours` : 'N/A'}\n`;
    text += `Currency: ${info.currency || 'N/A'}\n`;
    text += `Mobile Network: ${info.mobile ? 'Yes' : 'No'}\n`;
    text += `Proxy/VPN: ${info.proxy ? 'Yes' : 'No'}\n`;
    text += `Hosting/Datacenter: ${info.hosting ? 'Yes' : 'No'}\n`;

    return text;
}
