# Portal Selectors — ACC District Nursing Visits (2026-07-08)

**Source:** `portal-map-2026-07-08-full.json` (CDP WebSocket capture, `webSocketUsed: true`, 45 links)  
**Generator:** `portal-discover.ps1` on work PC (Citrix VPN + manual SSO)  
**Page:** SSRS folder browse — `ACC District Nursing Visits` under `DHB-wide/ACC`

---

## Capture verdict

| Check | Result |
|-------|--------|
| `webSocketUsed` | `true` (full DOM link harvest; prior partial sample had `false` + 0 links) |
| Link count | **45** |
| Page title | `ACC District Nursing Visits - SQL Server Reporting Services` |
| Page URL | `http://cl-biprddb02/Reports_MSREPORT/report/DHB-wide/ACC/ACC%20District%20Nursing%20Visits` |
| PHI in links | **None** — chrome/navigation only; safe to commit |
| Table/grid data | **Not captured** — folder browse UI only |
| Report parameters | **Not captured** — user stayed on folder view |

---

## Naming: Visit vs Visits

| Source | Text |
|--------|------|
| Screenshot 3 (circled report) | **ACC District Nursing Visit** (singular) |
| Live URL + browser title | **ACC District Nursing Visits** (plural) |
| Folder path in hrefs | `%2FACC%20District%20Nursing%20Visits` (plural) |

**P8-010 implication:** Match folder/report by **plural** `Visits` in URL and SSRS title. Treat screenshot label as informal shorthand.

---

## Headings & breadcrumbs

- **`headings` array:** empty (SSRS does not expose `<h1>`–`<h6>` on this view).
- **`breadcrumbs` array:** empty (tool did not parse breadcrumb widget).
- **Breadcrumb nav links** (usable for P8-010 path replay):

| Text | href | Role |
|------|------|------|
| Home | `browse/` | a |
| DHB-wide | `browse/DHB-wide` | a |
| ACC | `browse/DHB-wide/ACC` | a |

**Entry URL from checklist D-02:** `http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC`  
**Captured URL:** same tree, deeper — `.../report/DHB-wide/ACC/ACC%20District%20Nursing%20Visits` (folder contents view).

---

## Notable links (automation targets)

### Folder / report chrome

| Text | href / pattern | Selector | Notes |
|------|----------------|----------|-------|
| View | `javascript:void(0);` | `[aria-label="View"]` | View mode toggle (Tiles/List nearby) |
| Manage folder | `javascript:void(0);` | `[aria-label="Manage folder"]` | Folder admin |
| Search | `javascript:void(0);` | `[aria-label="Search"]` | Portal search |
| Show hidden items | `javascript:void(0);` | `[aria-label="Show hidden items"]` | checkbox |
| New | `javascript:void(0);` | `[aria-label="New"]` | Create menu |
| Favorites | `favorites` | — | button |
| Browse | `browse/` | — | button |
| Upload | `""` | — | button |

### SSRS header / global nav

| Text | href |
|------|------|
| Health and Business Intelligence Reports (Health Analytics) | `browse/` |
| My subscriptions | `manage/subscriptions/browse` |
| Back | `javascript:void(0);` |

### New-item menu (folder context)

Paginated Report, Dataset, Mobile Report hrefs embed `FolderPath=%2FDHB-wide%2FACC%2FACC%20District%20Nursing%20Visits` — confirms canonical folder path for Playwright navigation.

---

## What P8-010 can use now

1. **Confirmed portal base:** `http://cl-biprddb02/Reports_MSREPORT/`
2. **Nav path:** `browse/` → `browse/DHB-wide` → `browse/DHB-wide/ACC` → open `ACC District Nursing Visits` folder.
3. **Stable aria-label selectors** for SSRS 2016+ portal chrome: `View`, `Search`, `Manage folder`, `New`, `Show hidden items`.
4. **CDP attach workflow validated** — WebSocket path returns link harvest (contrast with partial capture).

## Still needed for P8-010 scrape config

1. **Open one paginated report** from this folder (e.g. daily status report) — capture `View Report` link + parameter form fields.
2. **Screenshot / second discover run** on report **results grid** with PO/claim/status columns marked (checklist D-09).
3. **D-02 field table** — which columns map to suite claim/PO fields.
4. **D-05/D-06** — browser choice and session timeout (for CDP launch command).

---

## Suggested Playwright flow (draft)

```
1. CDP attach to logged-in Edge/Chrome (VPN + SSO manual)
2. Navigate browse/DHB-wide/ACC (or deep-link report folder URL)
3. Click report tile/link by visible name (needs next capture — no report rows in this sample)
4. Fill parameter inputs (TBD)
5. Click View Report / Run
6. Scrape result table headers + rows (TBD)
```

---

*Ingested 2026-07-08 from work-laptop Portal Discover outputs.*
