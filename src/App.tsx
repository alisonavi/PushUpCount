import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { supabase } from "./lib/supabase";

type PersonKey = "bekzat" | "batyr";

type Entry = {
  id: string;
  date: string; // YYYY-MM-DD
  person: PersonKey;
  count: number;
};

const PEOPLE: Record<PersonKey, string> = {
  bekzat: "Bekzat Saulebay",
  batyr: "Batyr Shairbek",
};

const STORAGE_KEY = "pushups-tracker-v1";
const START_DATE = "2025-09-18";

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayString(): string {
  return formatDate(new Date());
}

function loadEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.date === "string" &&
        (e.person === "bekzat" || e.person === "batyr") &&
        typeof e.count === "number"
    );
  } catch {
    return [];
  }
}

function saveEntries(entries: Entry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function App() {
  const [entries, setEntries] = useState<Entry[]>(() => loadEntries());
  const [person, setPerson] = useState<PersonKey>("bekzat");
  const [count, setCount] = useState<string>("");
  const [date, setDate] = useState<string>(() => todayString());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    saveEntries(entries);
  }, [entries]);

  // Fetch from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const { data, error } = await supabase
          .from("pushups")
          .select("id, date, person, count")
          .gte("date", START_DATE)
          .lte("date", todayString())
          .order("date", { ascending: false });
        if (error) throw error;
        if (data) {
          const mapped: Entry[] = data.map((r: any) => ({
            id: String(r.id),
            date: r.date,
            person: r.person as PersonKey,
            count: Number(r.count),
          }));
          setEntries(mapped);
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const inRangeEntries = useMemo(() => {
    return entries.filter(
      (e) => e.date >= START_DATE && e.date <= todayString()
    );
  }, [entries]);

  const totals = useMemo(() => {
    const t: Record<PersonKey, number> = { bekzat: 0, batyr: 0 };
    for (const e of inRangeEntries) {
      t[e.person] += e.count;
    }
    return t;
  }, [inRangeEntries]);

  const dailyByPerson = useMemo(() => {
    const map: Record<string, Record<PersonKey, number>> = {};
    for (const e of inRangeEntries) {
      if (!map[e.date]) map[e.date] = { bekzat: 0, batyr: 0 };
      map[e.date][e.person] += e.count;
    }
    return map;
  }, [inRangeEntries]);

  async function addEntry() {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    const d = date || todayString();
    if (d < START_DATE || d > todayString()) return;
    const newEntry: Entry = {
      id: crypto.randomUUID(),
      date: d,
      person,
      count: Math.floor(n),
    };
    setEntries((prev) => [newEntry, ...prev]);
    setCount("");

    // Persist to Supabase (replace optimistic temp id with real id)
    const { data, error } = await supabase
      .from("pushups")
      .insert([{ date: d, person, count: newEntry.count }])
      .select("id, date, person, count")
      .single();
    if (error) {
      setError(error.message);
      // revert optimistic on failure
      setEntries((prev) => prev.filter((e) => e.id !== newEntry.id));
      return;
    }
    if (data) {
      const saved: Entry = {
        id: String(data.id),
        date: data.date,
        person: data.person as PersonKey,
        count: Number(data.count),
      };
      setEntries((prev) => [
        saved,
        ...prev.filter((e) => e.id !== newEntry.id),
      ]);
    }
  }

  async function clearAll() {
    if (!confirm("Clear all pushups data?")) return;
    try {
      setLoading(true);
      setError("");
      const { error } = await supabase
        .from("pushups")
        .delete()
        .gte("date", START_DATE)
        .lte("date", todayString());
      if (error) throw error;
      setEntries([]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to clear data");
    } finally {
      setLoading(false);
    }
  }

  const datesSorted = useMemo(() => {
    return Object.keys(dailyByPerson).sort((a, b) => (a < b ? 1 : -1));
  }, [dailyByPerson]);

  return (
    <div className="container">
      <h1>Pushups Tracker</h1>
      <p className="subtitle">
        From {START_DATE} to {todayString()}
      </p>

      <div className="grid">
        <div className="card input-card">
          <h2>Add Pushups</h2>
          <div className="field-row">
            <label className="label">Person</label>
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value as PersonKey)}
              className="input"
            >
              <option value="bekzat">{PEOPLE.bekzat}</option>
              <option value="batyr">{PEOPLE.batyr}</option>
            </select>
          </div>
          <div className="field-row">
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={START_DATE}
              max={todayString()}
            />
          </div>
          <div className="field-row">
            <label className="label">Count</label>
            <input
              type="number"
              className="input"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="e.g. 20"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <button className="primary" onClick={addEntry}>
            Add
          </button>
          <button className="danger" onClick={clearAll}>
            Clear All
          </button>
        </div>

        <div className="card totals-card">
          <h2>Totals</h2>
          <div className="totals">
            <div className="total">
              <div className="total-name">{PEOPLE.bekzat}</div>
              <div className="total-value">{totals.bekzat}</div>
            </div>
            <div className="total">
              <div className="total-name">{PEOPLE.batyr}</div>
              <div className="total-value">{totals.batyr}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card history-card">
        <h2>Daily History</h2>
        {datesSorted.length === 0 ? (
          <p className="muted">No entries yet.</p>
        ) : (
          <ul className="history-list">
            {datesSorted.map((d) => (
              <li key={d} className="history-item">
                <div className="history-date">{d}</div>
                <div className="history-people">
                  <span>
                    {PEOPLE.bekzat}:{" "}
                    <strong>{dailyByPerson[d]?.bekzat ?? 0}</strong>
                  </span>
                  <span>
                    {PEOPLE.batyr}:{" "}
                    <strong>{dailyByPerson[d]?.batyr ?? 0}</strong>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default App;
