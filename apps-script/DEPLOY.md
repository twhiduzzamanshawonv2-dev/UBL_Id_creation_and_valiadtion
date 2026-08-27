> ⚠️ **Legacy / Deprecated.** The live app now uses Supabase PostgreSQL - see
> [../MIGRATION.md](../MIGRATION.md) and [../supabase/schema.sql](../supabase/schema.sql).
> This Apps Script Web App is kept running only as a **backup / migration data
> source** (the migration script reads from it) until the Supabase migration
> is fully verified. Do not point the frontend at this URL again after that.

# Google Sheet ke Database Banano - Deployment Guide

Ei guide follow korle apnar app er "database" hobe ekta Google Sheet. Notun user create korle sheet e ekta row add hobe, edit/status-toggle korle sheet update hobe, ar Admin Dashboard shob shomoy sheet theke live data dekhabe.

Spreadsheet ta **role onujayi 3 ta alada tab/sheet** e organize kora - **BP**, **Supervisor**, **FC**. Notun user create korle, tar Designation onujayi shothik tab e row add hobe. Kew jodi "Edit User" diye kono user er Designation change kore (e.g. BP theke Supervisor), tar row automatically purono tab theke delete hoye notun tab e move hoye jabe - alada kore kichu korte hobe na.

Ei kaj gulo shudhu APNAKE korte hobe (Google account lagbe, tai Claude eta directly korte pare na):

---

## Step 1: Notun Google Sheet toiri korun

1. https://sheets.google.com e jan
2. **Blank** spreadsheet toiri korun (jekono naam din, e.g. "UBL User Database")
3. Sheet ta open thakben - porer step e ei sheet er sathei script attach korben

---

## Step 2: Apps Script attach korun

1. Sheet er upore menu theke **Extensions -> Apps Script** e click korun
2. Ekta notun tab e Apps Script editor khulbe, default e `Code.gs` file thakbe khali
3. Oi khali file er shob content delete kore diye, ei repo er
   `apps-script/Code.gs` file er PURA content copy kore paste kore din
4. Upore **Save project** (Ctrl+S) chapun - project ke jekono naam din (e.g. "UBL Backend")

---

## Step 3: Web App hisebe Deploy korun

1. Upore-dane **Deploy -> New deployment** e click korun
2. Gear/settings icon e click kore **"Web app"** select korun (type hisebe)
3. Configuration:
   - **Description**: jekono kichu likhun (e.g. "v1")
   - **Execute as**: **Me (apnar email)**
   - **Who has access**: **Anyone** (eta important - na hole app theke call korte parben na)
4. **Deploy** button e click korun
5. Prothom bar deploy korar shomoy Google ekta **Authorization** popup dekhabe:
   - Apnar Google account select korun
   - "Google hasn't verified this app" warning ashte pare (eta normal, karon ei script apni nijei banaichen) - **Advanced -> Go to [project name] (unsafe)** e click kore continue korun
   - Permissions accept korun (Sheet ar Drive access lagbe, karon image upload er jonno Drive use kora hoy)
6. Deploy shesh hole ekta **Web app URL** dekhabe, jeta emon dekhte hobe:
   ```
   https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
   ```
   Ei URL ta **copy kore rakhun** - porer step e lagbe

---

## Step 4: App er sathe connect korun

1. Ei project er `js/storage.js` file khulun
2. Upore dikkhe ei line ta khuja:
   ```js
   const SHEET_API_URL = 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
3. `'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE'` er jaygay Step 3 e paoa URL ta boshan:
   ```js
   const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycb....../exec';
   ```
4. File save korun

---

## Step 5: Test korun

1. `index.html` browser e open korun (ba refresh korun jodi age theke khola thake)
2. Admin Dashboard tab e jan - jodi shob thik thake, tahole ekta "Loading users from Google Sheet..." message dekhabe, tarpor 3ta sample user dekhabe (ekta FC, ekta Supervisor jei FC ke report kore, ar ekta BP jei Supervisor ke report kore)
3. Notun user create kore submit korun - tarpor Google Sheet ta refresh diye dekhun, apnar Designation onujayi shothik tab e (BP/Supervisor/FC) notun ekta row add hoyeche kina
4. Jodi kono error dekhen (page er upore lal ekta banner), tar mane URL thik nei ba deployment e problem ache - Step 3-4 abar check korun

---

## Guruttopurno Note gulo

- **Ekbar deploy korar por Code.gs e kono change korle, abar notun kore Deploy korte hobe**
  (Deploy -> Manage deployments -> Edit (pencil icon) -> Version: "New version" -> Deploy).
  Sudhu save korlei hobe na, deploy na korle purono code i cholbe.
- **Image (User Photo, NID Front/Back)**: eigulo shorashori Sheet cell e rakha jay na
  (onek boro base64 data, Sheet cell er 50,000 character limit ache). Tai script ta image
  gulo ke automatically Google Drive e ekta folder e ("UBL_ID_Creation_Uploads") upload kore,
  ar Sheet e shudhu shei image er link/URL rakhe.
- **"Reset All Data"** button (System Settings e) - eta pura Sheet clear kore abar 2ta
  sample user diye seed kore dey, thik ageer moto (LocalStorage version e jemon hoto).
- Onek jon eksathe app use korle, Google Apps Script er nijer ekta daily quota/rate-limit
  ache (shadaron use er jonno kono problem hobe na, kintu khub high-traffic hole limit e
  hit korte pare).
- **Notun `Code.gs` e Gender field add kora hoyeche (Age theke deploy kora BP/Supervisor/FC
  tab e Gender column chilo na)?** Kono chinta nei - notun `Code.gs` deploy korar por, prottek
  tab er "Name" column er thik pore ekta notun blank "Gender" column automatically add hoye
  jabe (script nijei kore dey, kono manual kaj lagbe na). Purono row gulor Gender field khali
  thakbe (segulo purono record, Gender chara toiri hoyechilo) - baki shob data (Name, Mobile,
  NID, ityadi) ekdom thik thakbe, kono shift/corrupt hobe na. Notun user create korle Gender
  select kora required, kintu purono user Edit korar shomoy Gender khali thakleo age korte
  hobe na.
- **Mobile Number er leading "0" (jemon `01712345678`) automatically chole jachhilo, `1712345678`
  hoye dekhachhilo?** Eta Google Sheets er nijer behavior - column ta "General" format e thakle,
  Sheets shob shomoy digit-only text ke number hishebe treat kore leading 0 fela dey, Apps Script
  theke string pathaleo. Notun `Code.gs` deploy korar por, prottek tab er Mobile column
  automatically "Plain Text" format e set hoye jabe (script nijei kore dey, kono manual kaj
  lagbe na) - tarpor theke notun/updated shob record er leading 0 thik thakbe. Kintu **purono
  row gulote jegulor leading 0 age theke hariye geche, segulo automatically fix hobe na** -
  shei number ta ekbar 0 chara shongkha hisebe store hoye gele, original value ta r recover kora
  jay na, tai purono data joto ache totuku e thake. Notun kore edit/re-enter korle thik hoye jabe.
  por, notun **BP**/**Supervisor**/**FC** tab gulo automatically toiri hoye jabe (khali obosthay),
  kintu purono "Users" tab er data automatically move hobe na - eta explicitly required na hole
  automatically kono data change kora thik na. Apnar 2 ta option:
  1. Purono "Users" tab theke prottek row manually copy kore shothik notun tab e (BP/Supervisor/FC)
     paste kore din, tarpor purono "Users" tab ta delete kore din.
  2. Ba, jodi test data hoy, "System Settings" -> "Reset All Data to Initial Defaults" click
     korle purono "Users" tab bade notun 3 ta tab e fresh sample data seed hobe (purono "Users"
     tab ta manually delete korte hobe, script eta chhue dekhbe na).

Kono step e atke gele bolben, together dekhbo.
