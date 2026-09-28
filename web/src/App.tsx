import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api, isUnrated } from './api';
import type { Benchmark, CorpusStats, FindingRow, Health, ScanRow } from './api';
import { CorpusView } from './CorpusView';
import { readTarget } from './target';
import { Findings, Index, Ledger, Meters, gradeInk } from './ui';

type Tab = 'scan' | 'corpus';

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('scan');
  const [health, setHealth] = useState<Health | null>(null);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ scan: ScanRow; findings: FindingRow[] } | null>(null);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; calm: boolean } | null>(null);
  const [entry, setEntry] = useState('');

  const reading = useMemo(() => readTarget(entry), [entry]);

  const refresh = useCallback(async () => {
    const [h, s, c] = await Promise.all([api.health(), api.scans(), api.corpus()]);
    setHealth(h);
    setScans(s.scans);
    setCorpus(c);
    return s.scans;
  }, []);

  useEffect(() => {
    refresh()
      .then((rows) => {
        const first = rows.find((r) => r.source === 'local') ?? rows[0];
        if (first) setSelected(first.id);
      })
      .catch((err: Error) => setOutcome({ text: err.message, calm: false }));
  }, [refresh]);

  useEffect(() => {
    if (selected === null) return;
    setFilter('all');

    Promise.all([api.scan(selected), api.benchmark(selected)])
      .then(([d, b]) => {
        setDetail(d);
        setBench(b);
      })
      .catch((err: Error) => setOutcome({ text: err.message, calm: false }));
  }, [selected]);

  async function run(label: string, action: () => Promise<{ scanId?: number }>): Promise<void> {
    setBusy(label);
    setOutcome(null);
    try {
      const result = await action();
      const rows = await refresh();
      if (result.scanId) setSelected(result.scanId);
      else if (rows[0]) setSelected(rows[0].id);
    } catch (err) {
      // "No agent configuration" is a finding about the repository, not a
      // failure of the request. Saying it in red trains people to ignore red.
      const calm = err instanceof ApiError && err.code === 'no-config';
      setOutcome({ text: err instanceof Error ? err.message : String(err), calm });
    } finally {
      setBusy(null);
    }
  }

  const unrated = detail ? isUnrated(detail.scan) : false;

  const readOnly = health?.hosted === true;

  const submit = (): void => {
    if (reading.kind === 'empty' || reading.kind === 'invalid') return;
    void run('scan', () => api.scanTarget(entry.trim()));
  };

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">Wardline</h1>
        <span className="stat">
          {health ? health.corpusSize + ' repositories benchmarked' : 'connecting'}
        </span>
        <span className="spacer" />
        <span className="stat">
          github {health?.githubAuthenticated ? 'authenticated' : 'anonymous'}
          {typeof health?.rateRemaining === 'number' ? ' / ' + health.rateRemaining + ' left' : ''}
        </span>
      </header>

      <nav className="nav">
        <button className={tab === 'scan' ? 'on' : ''} onClick={() => setTab('scan')}>
          Scans
        </button>
        <button className={tab === 'corpus' ? 'on' : ''} onClick={() => setTab('corpus')}>
          Corpus
        </button>
      </nav>

      {tab === 'corpus' ? (
        <CorpusView
          corpus={corpus}
          busy={busy}
          onIngest={() => run('ingest', () => api.ingest(20).then(() => ({})))}
        />
      ) : (
        <div className="bento split enter">
          <div>
            <section className="card">
              <p className="eyebrow">Audit a configuration</p>
              <div className="entry">
                <input
                  placeholder={
                    readOnly
                      ? 'read-only deployment'
                      : 'github.com/owner/repo, or a local path'
                  }
                  value={entry}
                  disabled={readOnly}
                  spellCheck={false}
                  onChange={(e) => setEntry(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
                <button
                  className="btn"
                  disabled={
                    readOnly ||
                    busy !== null ||
                    reading.kind === 'empty' ||
                    reading.kind === 'invalid'
                  }
                  onClick={submit}
                >
                  {busy === 'scan' ? 'Working' : 'Audit'}
                </button>
              </div>

              {reading.kind !== 'empty' && (
                <p className={'readout' + (reading.kind === 'invalid' ? ' bad' : '')}>
                  <span className="dot" />
                  <span>{reading.say}</span>
                </p>
              )}

              <p className="note">
                {readOnly ? (
                  <>
                    This is a public, read-only deployment: browse the corpus, the benchmark and
                    every rule, but nothing here scans anything. Auditing reads files, so it runs
                    on your machine, not on a server you do not control.{' '}
                    <code>npx wardline scan</code>
                  </>
                ) : (
                  <>
                    A GitHub address is fetched over the API and joins the benchmark corpus.
                    Anything else is read from this machine and stays private to it.
                  </>
                )}
              </p>

              {outcome && (
                <p className={'readout ' + (outcome.calm ? 'calm' : 'bad')}>
                  <span className="dot" />
                  <span>{outcome.text}</span>
                </p>
              )}
            </section>

            <section className="card">
              <p className="eyebrow">History</p>
              <Index scans={scans} selected={selected} onSelect={setSelected} />
            </section>
          </div>

          <div>
            {bench && detail ? (
              <>
                <section className="card hover">
                  <p className="eyebrow">Verdict</p>
                  <p className="subject">{detail.scan.slug}</p>
                  {detail.scan.harnesses.length > 0 && (
                    <p className="agents">
                      {detail.scan.harnesses.map((label) => (
                        <span className="pill good" key={label}>
                          {label}
                        </span>
                      ))}
                    </p>
                  )}

                  {unrated ? (
                    <>
                      <div className="verdict-head">
                        <span className="letter" style={{ color: 'var(--ink-faint)' }}>
                          &ndash;
                        </span>
                        <span className="figures">
                          <span className="score" style={{ fontSize: 21 }}>
                            not enough configuration to rate
                          </span>
                        </span>
                      </div>
                      <div className="placement">
                        <div className="against">
                          Only {detail.scan.config_bytes} bytes across{' '}
                          {detail.scan.files_scanned} file(s). Nothing was flagged because there
                          was almost nothing to read, so no grade is claimed and this repository
                          is kept out of the benchmark.
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="verdict-head">
                        <span className="letter" style={{ color: gradeInk(bench.overall.grade) }}>
                          {bench.overall.grade}
                        </span>
                        <span className="figures">
                          <span className="score">
                            {bench.overall.score}
                            <span> / 100</span>
                          </span>
                        </span>
                      </div>

                      {bench.corpusSize > 0 && (
                        <div className="placement">
                          <div className="rank">{bench.overall.verdict}</div>
                          <div className="against">
                            {bench.overall.percentile}th percentile of {bench.corpusSize} real
                            repositories, median {bench.overall.corpusMedian}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <p className="note tight">
                    Read {detail.scan.files_scanned} configuration file(s),{' '}
                    {detail.scan.config_bytes} bytes.
                  </p>

                  {detail.scan.truncated === 1 && (
                    <p className="readout bad">
                      <span className="dot" />
                      <span>Partial scan: the file ceiling was reached</span>
                    </p>
                  )}
                </section>

                {!unrated && (
                  <section className="card hover">
                    <p className="eyebrow">By category, against the corpus median</p>
                    <Meters rows={bench.categories} />
                  </section>
                )}

                <div className="bento halves" hidden={unrated}>
                  <section className="card hover">
                    <p className="eyebrow">Rare in the corpus</p>
                    <Ledger gaps={bench.uncommonIssues} mode="yours" />
                  </section>
                  <section className="card hover">
                    <p className="eyebrow">Common, and absent here</p>
                    <Ledger gaps={bench.avoidedIssues} mode="avoided" />
                  </section>
                </div>

                <section className="card">
                  <p className="eyebrow">Findings</p>
                  <Findings findings={detail.findings} filter={filter} onFilter={setFilter} />
                </section>
              </>
            ) : (
              <section className="card">
                <p className="blank">Select a scan, or audit something on the left.</p>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
