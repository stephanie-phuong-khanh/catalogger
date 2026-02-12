1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). You should see the form (Excel upload, vendor website, and two placeholders).

3. **Run the pipeline separately (unchanged)**
   ```bash
   npm run pipeline
   ```
   This still runs from the command line and writes to `data/listings/`. The app does not run the pipeline yet.
