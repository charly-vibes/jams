# Create scaffolding for a new page
new PAGE_NAME:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -d "{{PAGE_NAME}}" ]; then
        echo "Error: Directory '{{PAGE_NAME}}' already exists"
        exit 1
    fi
    echo "Creating scaffolding for {{PAGE_NAME}}..."
    mkdir -p "{{PAGE_NAME}}/spec" "{{PAGE_NAME}}/sessions"

    cat > "{{PAGE_NAME}}/index.html" << 'EOF'
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{{PAGE_NAME}}</title>
        <link rel="stylesheet" href="style.css">
    </head>
    <body>
        <a href="../" class="home-link">←</a>
        <main>
            <h1>{{PAGE_NAME}}</h1>
        </main>
        <footer>
            <a href="https://github.com/charly-vibes/jams/tree/main/{{PAGE_NAME}}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
        </footer>
        <script src="script.js"></script>
    </body>
    </html>
    EOF

    cat > "{{PAGE_NAME}}/style.css" << 'EOF'
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }

    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #f5f5f5;
        color: #333;
        line-height: 1.6;
        padding: 2rem;
    }

    main {
        max-width: 800px;
        margin: 0 auto;
        background: #fff;
        padding: 2rem;
        border: 1px solid #ddd;
    }

    h1 {
        margin-bottom: 1rem;
        font-weight: 600;
    }

    .home-link {
        position: fixed;
        top: 1rem;
        left: 1rem;
        color: #999;
        text-decoration: none;
        font-size: 1.25rem;
        line-height: 1;
        opacity: 0.5;
        transition: opacity 0.2s;
    }

    .home-link:hover {
        opacity: 0.8;
    }

    footer {
        max-width: 800px;
        margin: 2rem auto 0;
        text-align: center;
        padding: 1rem;
        color: #666;
        font-size: 0.875rem;
    }

    footer a {
        color: #666;
        text-decoration: none;
        border-bottom: 1px solid #ccc;
    }

    footer a:hover {
        color: #333;
        border-bottom-color: #333;
    }
    EOF

    cat > "{{PAGE_NAME}}/script.js" << 'EOF'
    // {{PAGE_NAME}} functionality

    document.addEventListener('DOMContentLoaded', () => {
        console.log('{{PAGE_NAME}} loaded');
    });
    EOF

    cat > "{{PAGE_NAME}}/spec/functionality.md" << 'EOF'
    # {{PAGE_NAME}} - Functionality Specification

    ## Purpose

    [Describe the purpose of this app]

    ## Features

    - [Feature 1]
    - [Feature 2]

    ## Requirements

    - [Requirement 1]
    - [Requirement 2]

    ## Behavior

    [Describe expected behavior]
    EOF

    echo "✓ Created {{PAGE_NAME}}/index.html"
    echo "✓ Created {{PAGE_NAME}}/style.css"
    echo "✓ Created {{PAGE_NAME}}/script.js"
    echo "✓ Created {{PAGE_NAME}}/spec/functionality.md"
    echo "✓ Created {{PAGE_NAME}}/sessions/ directory"
    echo ""
    echo "Scaffolding complete! Edit the spec and start building."

# Build generated assets (apps metadata)
build:
    @bash build-metadata.sh > apps-metadata.json
    @echo "✓ Built apps-metadata.json"

# Start local development server (HTTP, for local machine testing)
serve PORT="8000": build
    @LAN_IP=$$(python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(("8.8.8.8",80)); print(s.getsockname()[0]); s.close()' 2>/dev/null || echo "<YOUR_IP>"); \
      echo "Starting HTTP server on http://localhost:{{PORT}}"; \
      echo ""; \
      echo "  ── Testing on this machine ──"; \
      echo "  http://localhost:{{PORT}}/transcribir/"; \
      echo ""; \
      echo "  ── Testing on another device (USB forwarding, SW works) ──"; \
      echo "  1. Connect phone via USB, enable USB debugging"; \
      echo "  2. Open chrome://inspect on desktop Chrome"; \
      echo "  3. Enable 'Port forwarding' → set port {{PORT}} → localhost:{{PORT}}"; \
      echo "  4. On phone Chrome, visit http://localhost:{{PORT}}/transcribir/"; \
      echo "     (localhost is treated as secure context — SW will work!)"; \
      echo ""; \
      echo "  ── Testing on another device (same network, no SW) ──"; \
      echo "  http://$$LAN_IP:{{PORT}}/transcribir/"; \
      echo "  ⚠️  SW requires secure context (share/offline won't work over HTTP)"; \
      echo ""; \
      echo "  ── HTTPS with trusted cert via tunnel (SW works) ──"; \
      echo "  Install cloudflared, then:  just tunnel PORT={{PORT}}"; \
      echo ""; \
      echo "Press Ctrl+C to stop"; \
      python3 -m http.server {{PORT}}

# Tunnel with cloudflared (public HTTPS URL, SW works on any device)
tunnel PORT="8000": build
    @if ! which cloudflared >/dev/null 2>&1; then \
      echo "Install cloudflared first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; \
      exit 1; \
    fi
    @echo "Starting cloudflared tunnel to http://localhost:{{PORT}}"
    @echo ""
    @echo "  cloudflared will print a public https://xxxx.trycloudflare.com URL"
    @echo "  Open that URL on your device — SW will work with the trusted cert"
    @echo ""
    @echo "First start the HTTP server in another terminal:"
    @echo "  just serve PORT={{PORT}}"
    @echo ""
    python3 -m cloudflared tunnel --url http://localhost:{{PORT}}

# Serve with HTTPS via mkcert + Python (requires mkcert cert on each device)
serve-ssl PORT="8443": build
    @if ! which mkcert >/dev/null 2>&1; then \
      echo "Install mkcert first: https://github.com/FiloSottile/mkcert"; \
      echo "Then run this command again."; \
      exit 1; \
    fi
    @LAN_IP="$(python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(("8.8.8.8",80)); print(s.getsockname()[0]); s.close()')"; \
      echo "Generating a trusted certificate for localhost and $LAN_IP..."; \
      mkcert -install; \
      mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1 "$LAN_IP"
    @echo "Starting HTTPS and collecting device diagnostics"
    python3 serve-https.py {{PORT}}

# Update branch by fetching and merging origin/main
update:
    @echo "Fetching from origin..."
    git fetch origin
    @echo "Merging origin/main..."
    git merge origin/main
    @echo "✓ Branch updated"

# Sync: add all changes, commit, and push
sync MESSAGE="Update":
    @echo "Adding changes..."
    git add .
    @echo "Committing..."
    git commit -m "{{MESSAGE}}"
    @echo "Pushing to origin..."
    git push
    @echo "✓ Changes synced"