FROM alpine:3.18

# small image with xmllint available
RUN apk add --no-cache libxml2-utils

WORKDIR /work

ENTRYPOINT ["xmllint"]
