-- F3 bike model database. Seeded from shared/bikeModels.ts (a unit test keeps
-- them in step). Readable by everyone; only migrations change it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.motorcycle_models (
  id text PRIMARY KEY,
  make text NOT NULL,
  model text NOT NULL,
  category text NOT NULL CHECK (category IN ('adventure','tourer','cruiser','sport','commuter','scooter')),
  tank_liters numeric(5,2) NOT NULL CHECK (tank_liters > 0 AND tank_liters <= 100),
  mileage_kmpl numeric(5,2) NOT NULL CHECK (mileage_kmpl > 0 AND mileage_kmpl <= 150),
  reserve_liters numeric(5,2) NOT NULL CHECK (reserve_liters >= 0 AND reserve_liters < tank_liters),
  UNIQUE (make, model)
);
ALTER TABLE public.motorcycle_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS motorcycle_models_read ON public.motorcycle_models;
CREATE POLICY motorcycle_models_read ON public.motorcycle_models FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.motorcycle_models FROM anon, authenticated;
GRANT SELECT ON public.motorcycle_models TO anon, authenticated;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS motorcycle_model_id text REFERENCES public.motorcycle_models(id) ON DELETE SET NULL;

INSERT INTO public.motorcycle_models (id, make, model, category, tank_liters, mileage_kmpl, reserve_liters) VALUES
  ('re-himalayan-450', 'Royal Enfield', 'Himalayan 450', 'adventure', 17, 30, 3),
  ('re-himalayan-411', 'Royal Enfield', 'Himalayan 411', 'adventure', 15, 30, 3),
  ('re-classic-350', 'Royal Enfield', 'Classic 350', 'cruiser', 13, 35, 2.5),
  ('re-bullet-350', 'Royal Enfield', 'Bullet 350', 'cruiser', 13, 35, 2.5),
  ('re-meteor-350', 'Royal Enfield', 'Meteor 350', 'cruiser', 15, 35, 3),
  ('re-hunter-350', 'Royal Enfield', 'Hunter 350', 'commuter', 13, 36, 2.5),
  ('re-interceptor-650', 'Royal Enfield', 'Interceptor 650', 'tourer', 13.7, 23, 3),
  ('re-continental-gt-650', 'Royal Enfield', 'Continental GT 650', 'sport', 12.5, 23, 3),
  ('re-super-meteor-650', 'Royal Enfield', 'Super Meteor 650', 'cruiser', 15.7, 22, 3),
  ('re-scram-411', 'Royal Enfield', 'Scram 411', 'adventure', 15, 30, 3),
  ('re-guerrilla-450', 'Royal Enfield', 'Guerrilla 450', 'commuter', 11, 29, 2),
  ('ktm-390-adventure', 'KTM', '390 Adventure', 'adventure', 14.5, 27, 2.5),
  ('ktm-250-adventure', 'KTM', '250 Adventure', 'adventure', 14.5, 30, 2.5),
  ('ktm-390-duke', 'KTM', '390 Duke', 'sport', 15, 28, 2.5),
  ('ktm-200-duke', 'KTM', '200 Duke', 'sport', 13.4, 35, 2),
  ('ktm-rc-390', 'KTM', 'RC 390', 'sport', 13.7, 27, 2.5),
  ('bajaj-dominar-400', 'Bajaj', 'Dominar 400', 'tourer', 13, 27, 3),
  ('bajaj-dominar-250', 'Bajaj', 'Dominar 250', 'tourer', 13, 33, 3),
  ('bajaj-pulsar-ns200', 'Bajaj', 'Pulsar NS200', 'sport', 12, 36, 2),
  ('bajaj-pulsar-n250', 'Bajaj', 'Pulsar N250', 'commuter', 14, 35, 2.5),
  ('bajaj-pulsar-150', 'Bajaj', 'Pulsar 150', 'commuter', 15, 45, 2.5),
  ('bajaj-avenger-220', 'Bajaj', 'Avenger Cruise 220', 'cruiser', 13, 40, 2.5),
  ('hero-xpulse-200-4v', 'Hero', 'XPulse 200 4V', 'adventure', 13, 40, 2),
  ('hero-xpulse-210', 'Hero', 'XPulse 210', 'adventure', 13, 38, 2),
  ('hero-xtreme-160r', 'Hero', 'Xtreme 160R', 'commuter', 12, 45, 2),
  ('hero-splendor-plus', 'Hero', 'Splendor Plus', 'commuter', 9.8, 65, 1.5),
  ('hero-mavrick-440', 'Hero', 'Mavrick 440', 'tourer', 13.5, 30, 2.5),
  ('tvs-apache-rtr-310', 'TVS', 'Apache RTR 310', 'sport', 11, 30, 2),
  ('tvs-apache-rr-310', 'TVS', 'Apache RR 310', 'sport', 11, 30, 2),
  ('tvs-apache-rtr-160-4v', 'TVS', 'Apache RTR 160 4V', 'commuter', 12, 45, 2),
  ('tvs-ronin', 'TVS', 'Ronin', 'cruiser', 14, 40, 2.5),
  ('tvs-jupiter-125', 'TVS', 'Jupiter 125', 'scooter', 5.1, 50, 1),
  ('tvs-ntorq-125', 'TVS', 'Ntorq 125', 'scooter', 5.8, 45, 1),
  ('honda-cb350', 'Honda', 'H''ness CB350', 'cruiser', 15, 35, 3),
  ('honda-cb350rs', 'Honda', 'CB350RS', 'commuter', 15, 35, 3),
  ('honda-cb200x', 'Honda', 'CB200X', 'adventure', 12, 40, 2),
  ('honda-nx500', 'Honda', 'NX500', 'adventure', 17.5, 27, 3),
  ('honda-shine-125', 'Honda', 'Shine 125', 'commuter', 10.5, 55, 1.5),
  ('honda-activa-6g', 'Honda', 'Activa 6G', 'scooter', 5.3, 50, 1),
  ('yamaha-r15-v4', 'Yamaha', 'R15 V4', 'sport', 11, 40, 2),
  ('yamaha-mt-15', 'Yamaha', 'MT-15', 'sport', 10, 45, 2),
  ('yamaha-fz-s', 'Yamaha', 'FZ-S FI', 'commuter', 13, 45, 2),
  ('suzuki-v-strom-sx', 'Suzuki', 'V-Strom SX 250', 'adventure', 12, 35, 2),
  ('suzuki-gixxer-sf-250', 'Suzuki', 'Gixxer SF 250', 'sport', 12, 35, 2),
  ('suzuki-access-125', 'Suzuki', 'Access 125', 'scooter', 5, 50, 1),
  ('jawa-42', 'Jawa', '42', 'cruiser', 14, 33, 2.5),
  ('yezdi-adventure', 'Yezdi', 'Adventure', 'adventure', 15.5, 30, 3),
  ('triumph-speed-400', 'Triumph', 'Speed 400', 'commuter', 13, 30, 2.5),
  ('triumph-scrambler-400x', 'Triumph', 'Scrambler 400 X', 'adventure', 13, 30, 2.5),
  ('triumph-tiger-900', 'Triumph', 'Tiger 900', 'adventure', 20, 19, 4),
  ('bmw-g310-gs', 'BMW', 'G 310 GS', 'adventure', 11, 30, 2),
  ('bmw-r1250-gs', 'BMW', 'R 1250 GS', 'adventure', 20, 18, 4),
  ('kawasaki-versys-650', 'Kawasaki', 'Versys 650', 'tourer', 21, 20, 4),
  ('kawasaki-z900', 'Kawasaki', 'Z900', 'sport', 17, 17, 3),
  ('harley-x440', 'Harley-Davidson', 'X440', 'cruiser', 13.5, 30, 2.5)
ON CONFLICT (id) DO UPDATE SET make = EXCLUDED.make, model = EXCLUDED.model, category = EXCLUDED.category,
  tank_liters = EXCLUDED.tank_liters, mileage_kmpl = EXCLUDED.mileage_kmpl, reserve_liters = EXCLUDED.reserve_liters;

COMMIT;
