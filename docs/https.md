# HTTPS

Installing the app on a phone and offline mode need HTTPS. The server itself
speaks plain HTTP, so put something in front of it that handles HTTPS. Three
ways:

## Tailscale or Caddy

- **Tailscale** (private, no open ports): on the server,
  `tailscale serve --bg 8080`. The app is then at
  `https://<machine>.<tailnet>.ts.net` for your devices on Tailscale.
- **Caddy** (public, automatic certificates): a `Caddyfile` with
  ```
  bite-stamped.example.com {
    reverse_proxy 127.0.0.1:8080
  }
  ```

Set `TRUST_PROXY=1` in both cases.

## Below a path of an existing Apache site

For example `https://www.example.com/bites/`. In `.env`:

```
HOST=127.0.0.1
PORT=8080
TRUST_PROXY=1
BASE_PATH=/bites
```

In the site's existing `<VirtualHost *:443>` block (needs `mod_proxy`,
`mod_proxy_http` and `mod_headers`; on Debian/Ubuntu
`sudo a2enmod proxy proxy_http headers`):

```apache
RedirectMatch 301 ^/bites$ /bites/
<Location "/bites/">
    ProxyPass        "http://127.0.0.1:8080/bites/"
    ProxyPassReverse "http://127.0.0.1:8080/bites/"
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # Only Apache's own forwarding headers should reach the app.
    RequestHeader unset X-Forwarded-For
    RequestHeader unset X-Forwarded-Host
</Location>
```

Then `sudo apachectl configtest` and reload Apache. Everything stays below
`/bites/`: the pages, the API (`/bites/api/`), the session cookie and the
offline cache. Note that the app then shares its origin with the rest of the
site: scripts on other pages of that site could read its local data and use
its API. That is fine for a site you control; otherwise give the app its own
subdomain.
