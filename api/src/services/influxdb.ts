import { InfluxDBClient } from '@influxdata/influxdb3-client';

const host     = process.env.INFLUX_HOST ?? 'localhost';
const port     = process.env.INFLUX_PORT ?? '8086';
const token    = process.env.INFLUX_TOKEN ?? '';
const database = process.env.INFLUX_DATABASE ?? 'cow';

const influxdb = new InfluxDBClient({
  host: `http://${host}:${port}`,
  token,
  database,
});

export default influxdb;

// InfluxDB 2.x v1-compat HTTP query (InfluxQL) — avoids gRPC/Arrow Flight
export async function queryInfluxQL(query: string): Promise<Array<Record<string, any>>> {
  const url = `http://${host}:${port}/query?db=${encodeURIComponent(database)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`InfluxDB query failed ${res.status}: ${await res.text()}`);

  const json = await res.json() as any;
  const rows: Array<Record<string, any>> = [];
  for (const series of (json?.results?.[0]?.series ?? [])) {
    const cols: string[]               = series.columns ?? [];
    const tags: Record<string, string> = series.tags    ?? {};
    for (const vals of (series.values ?? [])) {
      const row: Record<string, any> = { ...tags };
      cols.forEach((c, i) => { row[c] = vals[i]; });
      rows.push(row);
    }
  }
  return rows;
}
