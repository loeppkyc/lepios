-- Cora's Future: programs, scholarships, planning notes
-- See docs/acceptance/mid-batch-coras-future.md

CREATE TABLE IF NOT EXISTS cora_future_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('program','scholarship','note')),
  name        TEXT NOT NULL,
  provider    TEXT,
  eligibility TEXT,
  value       TEXT,
  timeline    TEXT CHECK (timeline IN ('Grade 11','Grade 12','Post-secondary') OR timeline IS NULL),
  dates       TEXT,
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming','open','applied','accepted','missed','rejected')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed with known programs for Cora (First Nations, Edmonton, ~Grade 6)
INSERT INTO cora_future_items (category, name, provider, eligibility, value, timeline, dates, url, status, notes)
VALUES
  ('program', 'WISEST Summer Research Program', 'University of Alberta',
   'Grade 11, 85% min average (math+science), young women & gender-diverse',
   'Free (Indigenous travel/accommodation subsidies available)',
   'Grade 11', 'July–August (apply ~March)',
   'https://www.ualberta.ca/en/science/outreach/wisest/index.html',
   'upcoming',
   '6-week immersive STEM at U of A. Grades above 85% don''t help — threshold only. Indigenous students encouraged to apply for subsidies within the application form.'),

  ('program', 'HYRS Health Youth Researcher Summer', 'University of Alberta',
   'Grade 11, First Nations/Metis/Inuit encouraged',
   'Paid ~$15/hr, 30–35 hrs/week',
   'Grade 11', 'July–August (apply ~March)',
   'https://www.ualberta.ca/en/medicine/programs/hyrs/index.html',
   'upcoming',
   'Health/medical research focus. Students are paid. Explicitly encourages Indigenous applicants.'),

  ('scholarship', 'RBC Future Launch Scholarship', 'RBC',
   'First Nations, Inuit, Metis students entering post-secondary',
   'Up to $10,000/year for up to 4 years',
   'Post-secondary', 'Annual application',
   '', 'upcoming',
   '20 scholarships awarded across Canada. Based on academics and community involvement.'),

  ('scholarship', 'Aboriginal Futures Scholarship', 'Aboriginal Futures (Alberta)',
   'First Nations students in Grade 12 completing diploma',
   'Up to 80% of tuition',
   'Grade 12', 'Grade 12 application',
   '', 'upcoming',
   'Alberta-based. For First Nations students completing high school diploma requirements.');

GRANT INSERT, UPDATE, DELETE ON cora_future_items TO service_role;
