-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.cabinet_games (
                                      device_id text NOT NULL,
                                      game_id text NOT NULL,
                                      installed boolean DEFAULT false,
                                      installed_version integer,
                                      CONSTRAINT cabinet_games_pkey PRIMARY KEY (device_id, game_id),
                                      CONSTRAINT cabinet_games_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id),
                                      CONSTRAINT cabinet_games_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id)
);
CREATE TABLE public.device_ledger (
                                      id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
                                      device_id text NOT NULL,
                                      type text NOT NULL CHECK (type = ANY (ARRAY['deposit'::text, 'withdrawal'::text, 'play'::text, 'bet'::text, 'win'::text])),
                                      amount numeric NOT NULL,
                                      balance_delta numeric NOT NULL,
                                      source text,
                                      metadata jsonb,
                                      created_at timestamp with time zone DEFAULT now(),
                                      CONSTRAINT device_ledger_pkey PRIMARY KEY (id),
                                      CONSTRAINT device_ledger_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id)
);
CREATE TABLE public.devices (
                                id uuid NOT NULL DEFAULT gen_random_uuid(),
                                device_id text NOT NULL UNIQUE,
                                name text,
                                created_at timestamp with time zone DEFAULT now(),
                                updated_at timestamp with time zone NOT NULL DEFAULT now(),
                                balance numeric NOT NULL DEFAULT 0.00,
                                CONSTRAINT devices_pkey PRIMARY KEY (id)
);
CREATE TABLE public.games (
                              id text NOT NULL,
                              name text NOT NULL,
                              type text NOT NULL CHECK (type = ANY (ARRAY['arcade'::text, 'casino'::text])),
                              price integer NOT NULL DEFAULT 0,
                              rom_path text,
                              package_url text,
                              box_art_url text,
                              enabled boolean NOT NULL DEFAULT true,
                              version integer NOT NULL DEFAULT 1,
                              created_at timestamp with time zone DEFAULT now(),
                              updated_at timestamp with time zone DEFAULT now(),
                              emulator_core text,
                              CONSTRAINT games_pkey PRIMARY KEY (id)
);
CREATE TABLE public.live_config (
                                    id boolean NOT NULL DEFAULT true,
                                    updated_at timestamp with time zone DEFAULT now(),
                                    gold_chance_initial double precision,
                                    gold_chance_refill double precision,
                                    red_wild_chance double precision,
                                    reel_weights jsonb,
                                    reel_weights_free jsonb,
                                    happy_hour boolean DEFAULT false,
                                    CONSTRAINT live_config_pkey PRIMARY KEY (id)
);
