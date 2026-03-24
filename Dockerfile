ARG DENO_VERSION=2.7.1

FROM denoland/deno:${DENO_VERSION}

WORKDIR /app

# Cache dependencies
COPY deno.json deno.lock ./
RUN deno install

# Copy source
COPY . .

EXPOSE 8080

CMD ["sh", "-c", "if [ -f /app/entrypoint.sh ]; then sh /app/entrypoint.sh; else deno task serve; fi"]
