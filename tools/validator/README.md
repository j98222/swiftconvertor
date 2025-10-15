Validator helper

This folder contains a small Dockerfile and a Node helper to validate XML using xmllint inside a container.

Build the image:

  npm run validator:build

Run validation (example):

  npm run validator:run -- app/test-data/last_response.xml app/xsds/pacs.009.001.06.xsd

The script mounts the repo into the container and calls xmllint --noout --schema <xsd> <xml>.
