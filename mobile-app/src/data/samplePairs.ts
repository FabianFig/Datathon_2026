// Public sample pairs from the UTSA metadata; images load from Hugging Face.
export const samplePairs = [
  {
    "index": 0,
    "before_id": "TX001_2016_NAIP",
    "after_id": "TX001_2017_NOAA",
    "locality": "Bear Creek / west Houston",
    "before_date": "2016-09-28",
    "after_date": "2017-08-30",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX001_2016_NAIP.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX001_2017_NOAA.png",
    "latitude": "29.843026",
    "longitude": "-95.638733",
    "dossier": {
      "summary": "The later image shows widespread flooding in a residential area, with water covering many homes and streets, a change from the dry state in the first image.",
      "visible_water_before": "yes",
      "visible_water_after": "yes",
      "evidence": [
        "Image 2 shows extensive water coverage in the residential area, while Image 1 does not.",
        "The water in Image 2 appears to be covering the ground and rooftops, indicating a flood.",
        "The water level in Image 2 is higher than in Image 1, and it is covering more areas"
      ],
      "limitations": [
        "The change is due to a flood, but the metadata indicates the images are from different years, so the timing of the flood is not certain.",
        "The images are aerial, and the resolution and alignment are not sufficient to confirm the exact cause of the change.",
        "The water in Image 2 is not clearly visible in the first image, so the change is not fully confirmed."
      ],
      "review_priority": "high"
    },
    "before_cue": {
      "cue_score": 0.3787,
      "threshold": 0.46,
      "above_threshold": false,
      "confidence": "marginal",
      "label": "No strong flood cue",
      "disclaimer": "Experimental FloodNet UAV cue. Not ground truth or flood depth."
    },
    "after_cue": {
      "cue_score": 0.9124,
      "threshold": 0.46,
      "above_threshold": true,
      "confidence": "high",
      "label": "Potential flooded road/structure",
      "disclaimer": "Experimental FloodNet UAV cue. Not ground truth or flood depth."
    }
  },
  {
    "index": 1,
    "before_id": "TX011_2016_NAIP",
    "after_id": "TX011_2017_NOAA",
    "locality": "Eldridge / northwest Houston",
    "before_date": "2016-09-28",
    "after_date": "2017-08-30",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX011_2016_NAIP.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX011_2017_NOAA.png",
    "latitude": "29.857319",
    "longitude": "-95.616760"
  },
  {
    "index": 2,
    "before_id": "TX018_2016_NAIP",
    "after_id": "TX018_2017_NOAA",
    "locality": "Kingwood / northeast Houston",
    "before_date": "2016-09-28",
    "after_date": "2017-08-31",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX018_2016_NAIP.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TX018_2017_NOAA.png",
    "latitude": "30.033433",
    "longitude": "-95.199280"
  },
  {
    "index": 3,
    "before_id": "TXH_15606_27004_before_20160921_USDA",
    "after_id": "TXH_15606_27004_after_20170901_NOAA",
    "locality": "Bevil Oaks / Pine Island Bayou",
    "before_date": "2016-09-21",
    "after_date": "2017-09-01",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15606_27004_before_20160921_USDA.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15606_27004_after_20170901_NOAA.png"
  },
  {
    "index": 4,
    "before_id": "TXH_15324_27124_before_20160928_USDA",
    "after_id": "TXH_15324_27124_after_20170831_NOAA",
    "locality": "Richmond / Rosenberg / Brazos",
    "before_date": "2016-09-28",
    "after_date": "2017-08-31",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15324_27124_before_20160928_USDA.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15324_27124_after_20170831_NOAA.png"
  },
  {
    "index": 5,
    "before_id": "TXH_15424_27028_before_20160928_USDA",
    "after_id": "TXH_15424_27028_after_20170831_NOAA",
    "locality": "Forest Cove / Kingwood",
    "before_date": "2016-09-28",
    "after_date": "2017-08-31",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15424_27028_before_20160928_USDA.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15424_27028_after_20170831_NOAA.png"
  },
  {
    "index": 6,
    "before_id": "TXH_15284_27106_before_20160929_USDA",
    "after_id": "TXH_15284_27106_after_20170903_NOAA",
    "locality": "Simonton / Brazos",
    "before_date": "2016-09-29",
    "after_date": "2017-09-03",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15284_27106_before_20160929_USDA.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15284_27106_after_20170903_NOAA.png"
  },
  {
    "index": 7,
    "before_id": "TXH_15340_27092_before_20160928_USDA",
    "after_id": "TXH_15340_27092_after_20170830_NOAA",
    "locality": "West Houston / Addicks and Barker",
    "before_date": "2016-09-28",
    "after_date": "2017-08-30",
    "source": "NOAA",
    "before_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15340_27092_before_20160928_USDA.png",
    "after_url": "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/images/TXH_15340_27092_after_20170830_NOAA.png"
  }
];
