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

type ExerciseKey = "pushups" | "abs";

function compareEntriesDesc(a: Entry, b: Entry): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;
  const aNum = Number(a.id);
  const bNum = Number(b.id);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
  return 0;
}

const PEOPLE: Record<PersonKey, string> = {
  bekzat: "Bekzat Saulebay",
  batyr: "Batyr Shairbek",
};

const STORAGE_KEY = "pushups-tracker-v1";
const START_DATE = "2025-09-18";

function getStorageKey(exercise: ExerciseKey): string {
  return `${STORAGE_KEY}-${exercise}`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayString(): string {
  return formatDate(new Date());
}

function loadEntries(storageKey: string): Entry[] {
  try {
    const raw = localStorage.getItem(storageKey);
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

function saveEntries(storageKey: string, entries: Entry[]) {
  localStorage.setItem(storageKey, JSON.stringify(entries));
}

function App() {
  const [activeTab, setActiveTab] = useState<ExerciseKey>("pushups");
  const [entries, setEntries] = useState<Entry[]>(() =>
    loadEntries(getStorageKey("pushups"))
  );
  const [person, setPerson] = useState<PersonKey>("bekzat");
  const [count, setCount] = useState<string>("");
  const [date, setDate] = useState<string>(() => todayString());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    saveEntries(getStorageKey(activeTab), entries);
  }, [entries, activeTab]);

  // Fetch from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const { data, error } = await supabase
          .from(activeTab)
          .select("id, date, person, count")
          .gte("date", START_DATE)
          .lte("date", todayString())
          .order("date", { ascending: false })
          .order("id", { ascending: false });
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
  }, [activeTab]);

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
    if (n > 300 && !confirm("That looks high. Save it anyway?")) return;
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
      .from(activeTab)
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

  async function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setPerson(entry.person);
    setDate(entry.date);
    setCount(String(entry.count));
  }

  async function saveEdit() {
    if (!editingId) return;
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    if (n > 300 && !confirm("That looks high. Save it anyway?")) return;
    const d = date || todayString();
    try {
      setLoading(true);
      setError("");
      const { data, error } = await supabase
        .from(activeTab)
        .update({ date: d, person, count: Math.floor(n) })
        .eq("id", editingId)
        .select("id, date, person, count")
        .single();
      if (error) throw error;
      if (data) {
        const updated: Entry = {
          id: String(data.id),
          date: data.date,
          person: data.person as PersonKey,
          count: Number(data.count),
        };
        setEntries((prev) =>
          prev.map((e) => (e.id === editingId ? updated : e))
        );
      }
      setEditingId(null);
      setCount("");
    } catch (e: any) {
      setError(e?.message ?? "Failed to update entry");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this entry?")) return;
    try {
      setLoading(true);
      setError("");
      const prev = entries;
      setEntries((p) => p.filter((e) => e.id !== id));
      const { error } = await supabase.from(activeTab).delete().eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete entry");
      // refetch to restore correct state
      const { data } = await supabase
        .from(activeTab)
        .select("id, date, person, count")
        .gte("date", START_DATE)
        .lte("date", todayString())
        .order("date", { ascending: false });
      if (data) {
        const mapped: Entry[] = data.map((r: any) => ({
          id: String(r.id),
          date: r.date,
          person: r.person as PersonKey,
          count: Number(r.count),
        }));
        setEntries(mapped);
      }
    } finally {
      setLoading(false);
    }
  }

  async function clearAll() {
    if (!confirm("Clear all pushups data?")) return;
    try {
      setLoading(true);
      setError("");
      const { error } = await supabase
        .from(activeTab)
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
      <h1>{activeTab === "pushups" ? "Pushups" : "Abs"} Tracker</h1>
      <p className="subtitle">
        From {START_DATE} to {todayString()}
      </p>
      {error ? <p className="muted">{error}</p> : null}

      <div className="tabs">
        <button
          className={`tab${activeTab === "pushups" ? " active" : ""}`}
          onClick={() => {
            setActiveTab("pushups");
          }}
          disabled={loading}
        >
          Pushups
        </button>
        <button
          className={`tab${activeTab === "abs" ? " active" : ""}`}
          onClick={() => {
            setActiveTab("abs");
          }}
          disabled={loading}
        >
          Abs
        </button>
      </div>

      <div className="grid">
        <div className="card input-card">
          <h2>Add {activeTab === "pushups" ? "Pushups" : "Abs"}</h2>
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
          {editingId ? (
            <button className="primary" onClick={saveEdit} disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </button>
          ) : (
            <button className="primary" onClick={addEntry} disabled={loading}>
              {loading ? "Saving…" : "Add"}
            </button>
          )}
          <button className="danger" onClick={clearAll} disabled={loading}>
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

      <div className="card history-card">
        <h2>Recent Entries</h2>
        {entries.length === 0 ? (
          <p className="muted">No entries yet.</p>
        ) : (
          <ul className="history-list">
            {[...entries]
              .sort(compareEntriesDesc)
              .slice(0, 15)
              .map((e) => (
                <li key={e.id} className="history-item">
                  <div className="history-date">{e.date}</div>
                  <div className="history-people">
                    <span>
                      {PEOPLE[e.person]}: <strong>{e.count}</strong>
                    </span>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => startEdit(e)}
                      disabled={loading}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      onClick={() => deleteEntry(e.id)}
                      disabled={loading}
                    >
                      Delete
                    </button>
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
