import React, { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend, ArcElement } from 'chart.js'
import { Bar, Pie } from 'react-chartjs-2'
import { Dialog } from '@headlessui/react'
import { SunIcon, MoonIcon, XMarkIcon, ClipboardDocumentCheckIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend, ArcElement)

// Passing Percentage
const PASSING_THRESHOLD = 50; // percentage

// Updated LEVELS array to include 0 and map labels
const LEVEL_CONFIG = [
  { level: 0, label: 'PB' },
  { level: 1, label: 'Level 1' },
  { level: 2, label: 'Level 2' },
  { level: 3, label: 'Level 3' },
  { level: 4, label: 'Level 4' },
]
const LOCATIONS = ["AliJiwani", "Gulshan-e-Noor"];
const DEFAULT_LEVEL = 2
const DEFAULT_LOCATION= 'AliJiwani'

const MONTHS = [
   "November25",
   "December25",
];

const RECENT_MONTH_PER_LOCATION = {
  AliJiwani: "November25",
  "Gulshan-e-Noor": "November25", // <-- Corrected
};

// Columns to display in the main table
const MAIN_TABLE_KEYS = [
  { label: 'Username', key: 'Username' },
  { label: 'Total Score', key: 'Total score', numeric: true },
  { label: 'Status', key: '__pass_fail__' }, // NEW COLUMN
  { label: 'Identity Number', key: 'Identity Number (SO Number)' },
  { label: 'Contact Number', key: 'Contact Number / Mobile Number' }
]

function useDarkMode() {
  const [dark, setDark] = useState(() => !!localStorage.getItem('dark'))
  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('dark', '1')
    } else {
      root.classList.remove('dark')
      localStorage.removeItem('dark')
    }
  }, [dark])
  return [dark, setDark]
}

function parseCSV(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data),
      error: (e) => reject(e),
    })
  })
}

/**
 * Standardizes text by removing extra spaces to ensure matching 
 * works between Response CSV and Meta CSV (which may have double spaces).
 */
function normalizeKey(str) {
  if (!str) return ''
  // Replace multiple spaces/newlines with a single space and trim
  return String(str).replace(/\s+/g, ' ').trim()
}

/**
 * Robustly detects question groups based on [Score] and [Feedback] suffixes.
 * Returns an array of objects: { baseName, normalizedName, questionKey, scoreKey, feedbackKey }
 */
function detectQuestionGroups(headers) {
  const groups = []
  
  // Identify columns that look like score columns (ending in [Score] or [score])
  const scoreCols = headers.filter(h => /\[score\]$/i.test(h.trim()))
  
  scoreCols.forEach(scoreKey => {
    // Determine the base question text by stripping the suffix
    const baseName = scoreKey.replace(/\s*\[score\]$/i, '')
    
    // Find the corresponding Question Column (should match baseName exactly or trimmed)
    const questionKey = headers.find(h => h === baseName || h.trim() === baseName.trim())
    
    // Find the corresponding Feedback Column
    const feedbackKey = headers.find(h => 
      h.trim() === `${baseName} [Feedback]` || 
      h.trim() === `${baseName} [feedback]` ||
      (h.includes(baseName) && /\[feedback\]$/i.test(h.trim()))
    )

    if (questionKey) {
      groups.push({
        baseName, // Kept as is for display
        normalizedName: normalizeKey(baseName), // Used for meta lookup
        questionKey,
        scoreKey,
        feedbackKey
      })
    }
  })

  return groups
}

function prettyNumber(n) {
  if (n === null || n === undefined || n === '') return '-' 
  const num = Number(n)
  if (isNaN(num)) return n
  return Math.round(num * 100) / 100
}

function extractScoreObj(v) {
  if (!v) return { score: 0, max: 0 };
  const m = String(v).match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (m) {
    return { score: Number(m[1]), max: Number(m[2]) };
  }
  const num = Number(v);
  if (!isNaN(num)) return { score: num, max: null };
  return { score: 0, max: 0 };
}

export default function App() {
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [month, setMonth] = useState(MONTHS[0]);

  const [responses, setResponses] = useState([])
  const [meta, setMeta] = useState([])
  const [headers, setHeaders] = useState([])
  const [questionGroups, setQuestionGroups] = useState([])
  const [dataError, setDataError] = useState(false) // New state for tracking data load failure
  
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const [selectedStudent, setSelectedStudent] = useState(null)
  
  // changes to restrict dark mode
  //const [dark, setDark] = useDarkMode() 
  const dark = false

  useEffect(() => {
    loadLevel(level)
  }, [level, location, month])

  useEffect(() => {
    const defaultMonth = RECENT_MONTH_PER_LOCATION[location] || MONTHS[0];
    loadLevel(level)
    setMonth(defaultMonth);
  }, [location])

  async function loadLevel(lv) {
    // Reset state immediately
    setResponses([]);
    setMeta([]);
    setHeaders([]);
    setQuestionGroups([]);
    setDataError(false);
    setSearch('');
    setPage(1);
    const base = `/${location}/${month}`;
    const respPath = `${base}/level${lv}_response.csv`;
    const metaPath = `${base}/meta_level${lv}.csv`;

    try {
      // --- Fetch response file ---
      let respText = '';
      try {
        const resp = await fetch(respPath);

        if (!resp.ok) throw new Error(`Response file missing for level ${lv}`);

        respText = await resp.text();

        //console.log(`Fetched ${respPath}:`);
        //console.log(respText.slice(0, 10)); // log first 500 chars for debugging

        const isHTML = respText.trim().startsWith('<!doctype html') || respText.trim().startsWith('<html');
        if (isHTML) {
          throw new Error(`Response file for level ${lv} is missing. Got HTML page instead of CSV.`);
        }

        // --- Guard: check if content looks like CSV ---
        const looksLikeCSV = respText.includes(',') || respText.trim().startsWith('"');
        if (!looksLikeCSV) {
          throw new Error(`Response file does not contain valid CSV for level ${lv}`);
        }

        // --- Parse CSV and filter out empty rows ---
        const parsedResp = (await parseCSV(respText)).filter(row =>
          Object.values(row).some(v => (v || '').toString().trim().length > 0)
        );

        if (!parsedResp.length) throw new Error(`No valid rows in response CSV for level ${lv}`);

        // --- Fetch and parse meta file (optional) ---
        let parsedMeta = [];
        try {
          const metaResp = await fetch(metaPath);
          if (metaResp.ok) {
            const metaText = await metaResp.text();
            if (metaText && (metaText.includes(',') || metaText.trim().startsWith('"'))) {
              parsedMeta = await parseCSV(metaText);
            } else {
              console.warn(`Meta file ${metaPath} does not look like valid CSV`);
            }
          }
        } catch (e) {
          console.warn(`Meta file ${metaPath} failed to load. Proceeding without metadata.`, e.message);
        }

        // --- Headers ---
        const firstRaw = Papa.parse(respText, { header: true, skipEmptyLines: true });
        const h = firstRaw.meta.fields || Object.keys(parsedResp[0] || {});

        // --- Detect question groups ---
        const qg = detectQuestionGroups(h);

        // --- Update state ---
        setResponses(parsedResp);
        setMeta(parsedMeta);
        setHeaders(h);
        setQuestionGroups(qg);
        setDataError(false);

        console.log(`Level ${lv} loaded successfully. Responses: ${parsedResp.length}, Meta: ${parsedMeta.length}`);
      } catch (e) {
        console.warn(`Failed to ${location} load level ${lv} response:`, e.message);
        setResponses([]);
        setMeta([]);
        setHeaders([]);
        setQuestionGroups([]);
        setDataError(true);
      }
    } catch (e) {
      console.error('Unexpected error in loadLevel:', e);
      setResponses([]);
      setMeta([]);
      setHeaders([]);
      setQuestionGroups([]);
      setDataError(true);
    }
  }



  // Map meta for quick lookup by Normalized Question text
  const metaMap = useMemo(() => {
    const map = {}
    meta.forEach(m => {
      if (m.Question) {
        // Use normalizeKey to handle fuzzy matching of whitespace
        map[normalizeKey(m.Question)] = m
      }
    })
    return map
  }, [meta])

  const filtered = useMemo(() => {
    if (!responses || responses.length === 0) return []
    const s = search.trim().toLowerCase()
    let arr = responses.filter(r => {
      if (!s) return true;
      return Object.values(r).some(v => String(v || '').toLowerCase().includes(s));
    })
    .filter(() => {
      // Since CSV has no location column,
      // we simply filter by current selected location.
      // Each level dataset is considered per-location view.
      return true; // or keep logic open if later each student has location
    });
    
    if (sortBy) {
      arr = arr.slice().sort((a,b) => {
        const A = a[sortBy] || ''
        const B = b[sortBy] || ''
        
        // Find if the key is numeric to sort numerically
        const isNumeric = MAIN_TABLE_KEYS.find(k => k.key === sortBy)?.numeric || false;
        
        let valA = A
        let valB = B
        
        if (sortBy === 'Total score' || isNumeric) {
           valA = extractScoreObj(A).score
           valB = extractScoreObj(B).score
        }

        const numA = Number(valA)
        const numB = Number(valB)
        
        if (!isNaN(numA) && !isNaN(numB)) {
          return (numA - numB) * (sortDir === 'asc' ? 1 : -1)
        }
        return String(A).localeCompare(String(B)) * (sortDir === 'asc' ? 1 : -1)
      })
    }
    return arr
  }, [responses, search, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageData = filtered.slice((page-1)*pageSize, page*pageSize)

  // Robust Analytics Calculation
  const analytics = useMemo(() => {
    if (dataError) {
      // CSV missing → no students
      return { totalStudents: 0, avg: 0, max: 0, min: 0, passCount: 0, passRate: 0, detectedMaxScore: 0 };
    }
    if (!responses || responses.length === 0) {
      return { totalStudents: 0, avg: 0, max: 0, min: 0, passCount: 0, passRate: 0, detectedMaxScore: 0 };
    }
    
    const totalStudents = responses.length || 0;
    const parsed = responses.map(r => extractScoreObj(r["Total score"] || r["Total Score"] || r["TotalScore"]));
    const scores = parsed.map(p => p.score);
    const maxScores = parsed.map(p => p.max).filter(x => x);
    const detectedMaxScore = maxScores.length ? Math.max(...maxScores) : Math.max(...scores);
    
    // Only calculate percentages if max score is detected and greater than zero
    const percentages = detectedMaxScore > 0 
      ? scores.map(s => (s / detectedMaxScore) * 100) 
      : Array(totalStudents).fill(0);
      
    const avg = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0;
    const passCount = percentages.filter(p => p >= PASSING_THRESHOLD).length;
    const min = percentages.length ? Math.min(...percentages) : 0;
    const max = percentages.length ? Math.max(...percentages) : 0;

    return { 
      totalStudents, 
      avg, 
      max, 
      min, 
      passCount, 
      passRate: totalStudents ? (passCount / totalStudents) * 100 : 0, 
      detectedMaxScore 
    };
  }, [responses, dataError]);

  function onSort(columnKey) {
    if (sortBy === columnKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortBy(columnKey); setSortDir('desc') }
  }

  function exportFilteredCSV() {
    const csv = Papa.unparse(filtered)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `level${level}_filtered.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Determine which groups are "Personal Info" vs "Questions"
  const { infoGroups, quizGroups } = useMemo(() => {
    const info = []
    const quiz = []
    
    questionGroups.forEach(g => {
      // Use normalized lookup
      const m = metaMap[g.normalizedName]
      
      const isPI = m ? (m.Section === 'Personal Info') : (
        // Fallback regex if meta is missing
        /name|email|identity|contact|mobile/i.test(g.baseName)
      )
      
      if (isPI) info.push(g)
      else quiz.push(g)
    })
    return { infoGroups: info, quizGroups: quiz }
  }, [questionGroups, metaMap])
  
  // Get current level label
  const currentLevelLabel = LEVEL_CONFIG.find(c => c.level === level)?.label || `Level ${level}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors">
      <div className="max-w-[1400px] mx-auto p-4">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Quiz Visualizer</h1>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {currentLevelLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Level Selector Buttons */}
            <div className="hidden sm:flex bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
              {LEVEL_CONFIG.map(l => (
                <button key={l.level} onClick={() => setLevel(l.level)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${level===l.level ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-60:0 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <select 
              value={location} 
              onChange={(e) => setLocation(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm cursor-pointer">
              {LOCATIONS.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            {/* Month */}
            <select 
              value={month} 
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm cursor-pointer">
              {
                MONTHS.map(m => (
                  <option key={m} value={m}>{m}</option>
                  )
                )
              }
            </select>
            {/* Dark Mode Toggle */}
            <button onClick={() => setDark(!dark)} className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              {dark ? <SunIcon className="w-5 h-5"/> : <MoonIcon className="w-5 h-5"/>}
            </button>
          </div>
        </header>
        
        {dataError && responses.length === 0 && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl text-red-800 dark:text-red-300 font-medium">
            No response data found for **{currentLevelLabel}** (expecting file: `level{level}_response.csv`). Displaying zero statistics.
          </div>
        )}

        {/* Analytics Cards */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Students</div>
            <div className="mt-2 text-3xl font-bold">{analytics.totalStudents}</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Average Score</div>
            <div className="mt-2 text-3xl font-bold">{prettyNumber(analytics.avg)}%</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Pass Rate (>=50%)</div>
            <div className="mt-2 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{Math.round(analytics.passRate)}%</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Score Range</div>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-xl font-semibold">{prettyNumber(analytics.min)}% - {prettyNumber(analytics.max)}%</span>
            </div>
            <div className="mt-3 h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div style={{ width: `${analytics.avg}%` }} className="h-full bg-indigo-500 rounded-full"/>
            </div>
          </div>
        </section>

        {/* Search & Toolbar */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <input 
            placeholder="Search students..." 
            value={search} 
            onChange={(e)=>{setSearch(e.target.value); setPage(1)}} 
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none" 
            disabled={dataError || responses.length === 0}
          />
          <div className="flex gap-2">
            <select value={pageSize} onChange={(e)=>{setPageSize(Number(e.target.value)); setPage(1)}} className="px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none cursor-pointer" disabled={dataError || responses.length === 0}>
              <option value={8}>8 rows</option>
              <option value={12}>12 rows</option>
              <option value={24}>24 rows</option>
            </select>
            <button onClick={exportFilteredCSV} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50" disabled={dataError || responses.length === 0}>
              Export CSV
            </button>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Table */}
          <div className="lg:col-span-2 flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex-1">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      {MAIN_TABLE_KEYS.map(({ label, key }) => (
                        <th key={key} onClick={()=>onSort(key)} className="px-6 py-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {label}
                            {sortBy === key && (
                              <span className="text-indigo-600 dark:text-indigo-400">{sortDir==='asc' ? '▲' : '▼'}</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {pageData.map((row, idx) => (
                      <tr 
                        key={idx} 
                        onClick={() => setSelectedStudent(row)} 
                        className="group cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors"
                      >
                        {MAIN_TABLE_KEYS.map(({ key }) => {
                          let value = row[key];
                          let cellClass = "text-gray-600 dark:text-gray-300"; // Base class

                          if (key === '__pass_fail__') {
                            const { score, max } = extractScoreObj(row['Total score']);
                            const percent = max ? (score / max) * 100 : 0;
                            value = percent >= PASSING_THRESHOLD ? 'PASS' : 'FAIL';

                            // Apply color classes based on the result
                            if (value === 'PASS') {
                              cellClass = 'text-emerald-700 dark:text-emerald-400 font-medium';
                            } else {
                              cellClass = 'text-rose-700 dark:text-rose-400 font-medium';
                            }
                          }

                          return (
                            <td 
                              key={key} 
                              className={`px-6 py-3.5 whitespace-nowrap ${cellClass}`} // Dynamic class
                            >
                              {value || '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {pageData.length === 0 && (
                      <tr>
                        <td colSpan={MAIN_TABLE_KEYS.length} className="px-6 py-8 text-center text-gray-500">
                          {dataError ? `No data loaded for ${currentLevelLabel}.` : 'No students found matching your search.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 px-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button 
                  disabled={page===1 || dataError}
                  onClick={()=>setPage(p=>Math.max(1,p-1))} 
                  className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                >
                  Previous
                </button>
                <button 
                  disabled={page===totalPages || dataError}
                  onClick={()=>setPage(p=>Math.min(totalPages,p+1))} 
                  className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Charts Sidebar */}
          <div className="space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold mb-4">Score Distribution</h3>
              <div className="h-64">
                <Bar
                  options={{ maintainAspectRatio: false, responsive: true }}
                  data={{
                    labels: ["0–20%", "21–40%", "41–60%", "61–80%", "81–100%"],
                    datasets: [{
                      label: "Students",
                      backgroundColor: '#6366f1',
                      borderRadius: 4,
                      data: dataError || responses.length === 0 ? [0, 0, 0, 0, 0] : [0, 20, 40, 60, 80, 100].slice(0, 5).map((_, i) => {
                        const rangeStart = i * 20;
                        const rangeEnd = i === 4 ? 100 : (i + 1) * 20;
                        return responses.filter(r => {
                          const { score, max } = extractScoreObj(r["Total score"]);
                          if (!max || max === 0) return false;
                          const pct = (score / max) * 100;
                          return pct >= rangeStart && pct <= rangeEnd;
                        }).length;
                      })
                    }]
                  }}
                />
              </div>
            </div>

            <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold mb-4">Pass vs Fail</h3>
              <div className="h-64 flex justify-center">
                <Pie
                  options={{ maintainAspectRatio: false }}
                  data={{
                    labels: ['Pass', 'Fail'],
                    datasets: [{
                      data: [analytics.passCount, analytics.totalStudents - analytics.passCount],
                      backgroundColor: ['#047857', '#B91C1C'],
                      borderColor: ['#6EE7B7', '#FCA5A5'],
                      borderWidth: 1,
                    }],
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Student Detail Modal */}
        <Dialog open={!!selectedStudent} onClose={()=>setSelectedStudent(null)} className="relative z-50">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
              {/* Modal Header */}
              {selectedStudent && (
                <>
                  <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-start bg-gray-50/50 dark:bg-gray-800/50">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {selectedStudent['Username'] || 'Student Details'}
                      </h2>
                      <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                        Submitted: {selectedStudent['Timestamp']}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="text-sm text-gray-500 dark:text-gray-400">Total Score</div>
                      <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {selectedStudent['Total score']}
                      </div>
                    </div>
                  </div>

                  {/* Modal Body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    
                    {/* Personal Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Standard Info Cards */}
                      {[
                        { label: 'Name', val: selectedStudent['Name'] },
                        { label: 'Email', val: selectedStudent['Email'] },
                        { label: 'Identity Number', val: selectedStudent['Identity Number (SO Number)'] },
                        { label: 'Contact', val: selectedStudent['Contact Number / Mobile Number'] }
                      ].map((item, i) => (
                        <div key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1">{item.label}</div>
                          <div className="text-gray-900 dark:text-gray-200 font-medium truncate" title={item.val}>{item.val || '-'}</div>
                        </div>
                      ))}

                      {/* Info from meta-detected columns */}
                      {infoGroups.map((g, idx) => {
                         if (/name|email|identity|contact/i.test(g.baseName)) return null;
                         return (
                           <div key={'meta-'+idx} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                             <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1">{g.baseName}</div>
                             <div className="text-gray-900 dark:text-gray-200 font-medium">{selectedStudent[g.questionKey]}</div>
                           </div>
                         )
                      })}
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-800 my-4"></div>

                    {/* Questions List */}
                    <div>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <ClipboardDocumentCheckIcon className="w-5 h-5 text-indigo-500"/>
                        Detailed Responses
                      </h3>
                      <div className="space-y-4">
                        {quizGroups.map((g, idx) => {
                          const question = g.baseName;
                          const response = selectedStudent[g.questionKey];
                          const score = selectedStudent[g.scoreKey];
                          const feedback = selectedStudent[g.feedbackKey];
                          // Use normalized lookup
                          const metaInfo = metaMap[g.normalizedName];

                          return (
                            <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors shadow-sm">
                              {/* Question Header */}
                              <div className="flex justify-between items-start gap-4 mb-3">
                                <div>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {metaInfo?.Type && (
                                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-gray-100 dark:bg-gray-700 text-gray-500">
                                        {metaInfo.Type}
                                      </span>
                                    )}
                                    {metaInfo?.Section && (
                                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                        {metaInfo.Section}
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="text-base font-medium text-gray-900 dark:text-gray-100 leading-snug">
                                    {question}
                                  </h4>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-xs text-gray-400 uppercase font-bold tracking-wide">Score</div>
                                  <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                                    {score || '-'}
                                  </div>
                                </div>
                              </div>

                              {/* Response, Correct Answer & Feedback Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                                
                                {/* User Response Column */}
                                <div className="space-y-4">
                                  <div>
                                    <div className="text-xs font-bold text-gray-400 uppercase mb-1">User Response</div>
                                    <div className="text-sm text-gray-800 dark:text-gray-300">
                                      {response || <span className="text-gray-400 italic">No response</span>}
                                    </div>
                                  </div>
                                  
                                  {/* Check if correct answer exists and is not 'OpenEnded' */}
                                  {metaInfo?.CorrectAnswer && metaInfo.CorrectAnswer !== 'OpenEnded' && (
                                    <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-500 uppercase mb-1">
                                        <CheckCircleIcon className="w-3.5 h-3.5" />
                                        Correct Answer
                                      </div>
                                      <div className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                                        {metaInfo.CorrectAnswer}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Feedback Column */}
                                {(feedback && feedback !== '--') ? (
                                  <div className="border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 pt-3 md:pt-0 md:pl-4">
                                    <div className="text-xs font-bold text-gray-400 uppercase mb-1">Feedback</div>
                                    <div className="text-sm text-gray-600 dark:text-gray-400 italic">
                                      {feedback}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="hidden md:flex items-center justify-center text-xs text-gray-300 dark:text-gray-700 italic">
                                    No feedback provided
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 text-right">
                    <button onClick={()=>setSelectedStudent(null)} className="px-5 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium transition-colors">
                      Close
                    </button>
                  </div>
                </>
              )}
            </Dialog.Panel>
          </div>
        </Dialog>

        <footer className="mt-12 text-center text-sm text-gray-400 pb-8">
          Quiz Visualizer • Reads from <code>/public/level[N]_response.csv</code> & <code>meta_level[N].csv</code>
        </footer>
      </div>
    </div>
  )
}