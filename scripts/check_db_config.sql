SELECT
  current_database() AS db,
  current_user       AS "user",
  inet_server_addr() AS host,
  inet_server_port() AS port,
  current_schema()   AS schema;
