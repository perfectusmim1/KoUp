INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31496, 'alti-ustu-istanbul', 'dizi', 'TR', 'Türkiye',
        'Altı Üstü İstanbul', 'Altı Üstü İstanbul', 'Altı Üstü İstanbul', 'Altı Üstü İstanbul, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        2, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/altiustuistanbulkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/altiustuistanbulkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'altı üstü i̇stanbul alti-ustu-istanbul yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31497, 'anne-yarisi', 'dizi', 'TR', 'Türkiye',
        'Anne Yarısı', 'Anne Yarısı', 'Anne Yarısı', 'Anne Yarısı, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        2, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/anneyarisikapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/anneyarisikapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'anne yarısı anne-yarisi yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31498, 'baskalarinin-hayati', 'dizi', 'TR', 'Türkiye',
        'Başkalarının Hayatı', 'Başkalarının Hayatı', 'Başkalarının Hayatı', 'Başkalarının Hayatı, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        2, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/baskalarinhayatikapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/baskalarinhayatikapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'başkalarının hayatı baskalarinin-hayati yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31499, 'daha-17', 'dizi', 'TR', 'Türkiye',
        'Daha 17', 'Daha 17', 'Daha 17', 'Daha 17, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        2, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/daha17kapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/daha17kapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'daha 17 daha-17 yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31500, 'evlilik-guzeldir', 'dizi', 'TR', 'Türkiye',
        'Evlilik Güzeldir', 'Evlilik Güzeldir', 'Evlilik Güzeldir', 'Evlilik Güzeldir, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        13, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/evlilikguzeldirkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/evlilikguzeldirkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'evlilik güzeldir evlilik-guzeldir yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31501, 'firtinaya-dogru', 'dizi', 'TR', 'Türkiye',
        'Fırtınaya Doğru', 'Fırtınaya Doğru', 'Fırtınaya Doğru', 'Fırtınaya Doğru, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        17, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/firtinayadogrukapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/firtinayadogrukapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'fırtınaya doğru firtinaya-dogru yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31502, 'gonul-dagi', 'dizi', 'TR', 'Türkiye',
        'Gönül Dağı', 'Gönül Dağı', 'Gönül Dağı', 'Gönül Dağı, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        68, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/gonuldagi3-min.jpg', 'https://www.ddizi.tel/diziresimleri/gonuldagi3-min.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'gönül dağı gonul-dagi yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31503, 'guller-ve-gunahlar', 'dizi', 'TR', 'Türkiye',
        'Güller ve Günahlar', 'Güller ve Günahlar', 'Güller ve Günahlar', 'Güller ve Günahlar, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        37, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/gullervegunahlarkapak-min.jpg', 'https://www.ddizi.tel/diziresimleri/gullervegunahlarkapak-min.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'güller ve günahlar guller-ve-gunahlar yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31504, 'gunesin-dogdugu-yer', 'dizi', 'TR', 'Türkiye',
        'Güneşin Doğduğu Yer', 'Güneşin Doğduğu Yer', 'Güneşin Doğduğu Yer', 'Güneşin Doğduğu Yer, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        5, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/gunesindogduguyerkpmin.jpg', 'https://www.ddizi.tel/diziresimleri/gunesindogduguyerkpmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'güneşin doğduğu yer gunesin-dogdugu-yer yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31505, 'halef-koklerin-cagrisi', 'dizi', 'TR', 'Türkiye',
        'Halef: Köklerin Çağrısı', 'Halef: Köklerin Çağrısı', 'Halef: Köklerin Çağrısı', 'Halef: Köklerin Çağrısı, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        39, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/halefkapak-min.jpg', 'https://www.ddizi.tel/diziresimleri/halefkapak-min.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'halef: köklerin çağrısı halef-koklerin-cagrisi yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31506, 'haysiyet', 'dizi', 'TR', 'Türkiye',
        'Haysiyet', 'Haysiyet', 'Haysiyet', 'Haysiyet, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        6, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/haysiyetkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/haysiyetkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'haysiyet haysiyet yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31507, 'kalbim-sana-emanet', 'dizi', 'TR', 'Türkiye',
        'Kalbim Sana Emanet', 'Kalbim Sana Emanet', 'Kalbim Sana Emanet', 'Kalbim Sana Emanet, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        36, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/kalbimsanaemanetkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/kalbimsanaemanetkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'kalbim sana emanet kalbim-sana-emanet yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31508, 'kizilcik-serbeti', 'dizi', 'TR', 'Türkiye',
        'Kızılcık Şerbeti', 'Kızılcık Şerbeti', 'Kızılcık Şerbeti', 'Kızılcık Şerbeti, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        52, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/kizilcikserbetikapak-min.jpg', 'https://www.ddizi.tel/diziresimleri/kizilcikserbetikapak-min.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'kızılcık şerbeti kizilcik-serbeti yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31509, 'masterchef-turkiye-2026', 'dizi', 'TR', 'Türkiye',
        'MasterChef Türkiye 2026', 'MasterChef Türkiye 2026', 'MasterChef Türkiye 2026', 'MasterChef Türkiye 2026, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        50, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/masterchefturkiye.jpg', 'https://www.ddizi.tel/diziresimleri/masterchefturkiye.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'masterchef türkiye 2026 masterchef-turkiye-2026 yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31510, 'mehmed-fetihler-sultani', 'dizi', 'TR', 'Türkiye',
        'Mehmed: Fetihler Sultanı', 'Mehmed: Fetihler Sultanı', 'Mehmed: Fetihler Sultanı', 'Mehmed: Fetihler Sultanı, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        68, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/mehmetfetihlerkapak-min.jpg', 'https://www.ddizi.tel/diziresimleri/mehmetfetihlerkapak-min.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'mehmed: fetihler sultanı mehmed-fetihler-sultani yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31511, 'mercan-kosk', 'dizi', 'TR', 'Türkiye',
        'Mercan Köşk', 'Mercan Köşk', 'Mercan Köşk', 'Mercan Köşk, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        6, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/mercankoskkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/mercankoskkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'mercan köşk mercan-kosk yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31512, 'muge-anli-ile-tatli-sert', 'dizi', 'TR', 'Türkiye',
        'Müge Anlı ile Tatlı Sert', 'Müge Anlı ile Tatlı Sert', 'Müge Anlı ile Tatlı Sert', 'Müge Anlı ile Tatlı Sert, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        1, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/mugeanliyeni.jpg', 'https://www.ddizi.tel/diziresimleri/mugeanliyeni.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'müge anlı ile tatlı sert muge-anli-ile-tatli-sert yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31513, 'muhtemel-ask', 'dizi', 'TR', 'Türkiye',
        'Muhtemel Aşk', 'Muhtemel Aşk', 'Muhtemel Aşk', 'Muhtemel Aşk, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        18, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/muhtemelaskkapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/muhtemelaskkapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'muhtemel aşk muhtemel-ask yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        31514, 'omur-usta', 'dizi', 'TR', 'Türkiye',
        'Ömür Usta', 'Ömür Usta', 'Ömür Usta', 'Ömür Usta, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.', 2026,
        3, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        'https://www.ddizi.tel/diziresimleri/omurustakapakmin.jpg', 'https://www.ddizi.tel/diziresimleri/omurustakapakmin.jpg', ARRAY['Yerli Dizi','Dram'], ARRAY['DDizi','Yerli Dizi'], ARRAY['ddizi'],
        450, 'ömür usta omur-usta yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;