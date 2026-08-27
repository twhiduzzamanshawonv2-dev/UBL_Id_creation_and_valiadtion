/**
 * Bangladesh Geographical Location Data
 * Division -> District -> Upazila -> Thana
 */
const BD_LOCATIONS = {
  "Dhaka": {
    "Dhaka": {
      "Savar": ["Savar", "Ashulia Thana"],
      "Keraniganj": ["Keraniganj", "Aganagar", "Jinjira", "Shobadda"],
      "Dhaka South City Corporation": ["Khilgaon", "Bangshal", "Chak Bazar", "Demra", "Dhanmondi", "Gendaria", "Hazaribagh", "Jatrabari", "Kadamtali", "Kalabagan", "Kamrangir Char", "Lalbagh", "Motijheel", "New Market", "Paltan", "Ramna", "Sabujbagh", "Shahbagh", "Shyampur", "Sutrapur", "Kotwali Dhaka", "Chankharpool", "Wari", "Shahjahanpur Dhaka", "Mugda"],
      "Dhaka North City Corporation": ["Adabor", "Badda", "Biman Bandar", "Dhaka Cantonment", "Dakshinkhan", "Darus Salam", "Gulshan", "Kafrul", "Khilkhet", "Pallabi", "Rampura", "Shah Ali", "Sher-E-Bangla Nagar", "Tejgaon Ind. Area", "Tejgaon", "Turag", "Uttar Khan", "Uttara", "Mirpur Dhaka", "Mohammadpur Dhaka", "Vatara", "Notun Bazar", "Banani", "Bhasantek", "Rupnagar", "Moghbazar", "Hatirjheel", "Kallyanpur"],
      "Dhamrai": ["Dhamrai"],
      "Dohar": ["Dohar"],
      "Nawabganj Dhaka": ["Nawabganj Dhaka"],
      "Hemayetpur": ["Hemayetpur"]
    },
    "Gazipur": {
      "Gazipur Sadar": ["Gazipur Sadar"],
      "Kapasia": ["Kapasia"],
      "Kaliganj Gazipur": ["Kaliganj Gazipur"],
      "Kaliakair": ["Kaliakair"],
      "Sreepur Gazipur": ["Sreepur Gazipur"],
      "Joydebpur": ["Joydebpur"],
      "Tongi": ["Tongi"],
      "Kashimpur": ["Kashimpur"],
      "Rajendrapur": ["Rajendrapur"]
    },
    "Narsingdi": {
      "Narsingdi Sadar": ["Narsingdi Sadar", "Madhabdi"],
      "Belabo": ["Belabo"],
      "Manohardi": ["Manohardi"],
      "Palash": ["Palash"],
      "Roypura": ["Roypura"],
      "Shibpur": ["Shibpur"],
      "Ghorashal": ["Ghorashal"]
    },
    "Kishoreganj": {
      "Bhairab": ["Bhairab"],
      "Austagram": ["Austagram"],
      "Bajitpur": ["Bajitpur"],
      "Hossainpur": ["Hossainpur"],
      "Itna": ["Itna"],
      "Karimganj": ["Karimganj"],
      "Katiadi": ["Katiadi"],
      "Kishoreganj Sadar": ["Kishoreganj Sadar"],
      "Kuliar Char": ["Kuliar Char"],
      "Mithamain": ["Mithamain"],
      "Nikli": ["Nikli"],
      "Pakundia": ["Pakundia"],
      "Tarail": ["Tarail"]
    },
    "Narayanganj": {
      "Narayanganj Sadar": ["Narayanganj Sadar", "Fatullah", "Kutubpur", "Shiddhirganj", "Taraboo"],
      "Sonargaon": ["Sonargaon"],
      "Bandar": ["Bandar"],
      "Rupganj": ["Rupganj"],
      "Araihazar": ["Araihazar"],
      "Mondonpur": ["Mondonpur"]
    },
    "Munshiganj": {
      "Lohajang": ["Lohajang"],
      "Munshiganj Sadar": ["Munshiganj Sadar"],
      "Serajdikhan": ["Serajdikhan", "Ichapura", "Malkhanagor", "Rasunia"],
      "Gazaria": ["Gazaria"],
      "Sreenagar": ["Sreenagar", "Rarikhal", "Bhagyakul", "Baghra", "Kolapara", "Shamsiddhi", "Shologhor", "Kukutia"],
      "Tongibari": ["Tongibari"]
    },
    "Tangail": {
      "Ghatail": ["Ghatail", "Dighalkandi", "Digar"],
      "Gopalpur": ["Gopalpur"],
      "Kalihati": ["Kalihati", "Kokdahara", "Balla", "Bangra", "Shahadebpur", "Birbasinda", "Paikara"],
      "Mirzapur": ["Mirzapur"],
      "Tangail Sadar": ["Tangail Sadar"],
      "Basail": ["Basail"],
      "Bhuapur": ["Bhuapur"],
      "Delduar": ["Delduar"],
      "Dhanbari": ["Dhanbari"],
      "Madhupur": ["Madhupur", "Golabari", "Ausnara", "Mirzabari", "Alokdia", "Modhupur Powrosova", "Kuragacha", "Aronkhola"],
      "Nagarpur": ["Nagarpur", "Mamud nagar"],
      "Sakhipur": ["Sakhipur"]
    },
    "Manikganj": {
      "Daulatpur Manikganj": ["Daulatpur Manikganj"],
      "Ghior": ["Ghior", "Paila", "Baliyakhora"],
      "Harirampur": ["Harirampur"],
      "Manikganj Sadar": ["Manikganj Sadar"],
      "Saturia": ["Saturia"],
      "Shibalaya": ["Shibalaya"],
      "Singair": ["Singair"]
    },
    "Faridpur": {
      "Alfadanga": ["Alfadanga"],
      "Bhanga": ["Bhanga"],
      "Boalmari": ["Boalmari", "Moyna", "Gunbaha", "Satair", "Dadpur"],
      "Char Bhadrasan": ["Char Bhadrasan"],
      "Faridpur Sadar": ["Faridpur Sadar"],
      "Madhukhali": ["Madhukhali"],
      "Nagarkanda": ["Nagarkanda", "Laskardia"],
      "Sadarpur": ["Sadarpur"],
      "Saltha": ["Saltha"]
    },
    "Gopalganj": {
      "Gopalganj Sadar": ["Gopalganj Sadar"],
      "Kashiani": ["Kashiani"],
      "Kotalipara": ["Kotalipara"],
      "Muksudpur": ["Muksudpur"],
      "Tungipara": ["Tungipara"]
    },
    "Madaripur": {
      "Kalkini": ["Kalkini"],
      "Madaripur Sadar": ["Madaripur Sadar"],
      "Rajoir": ["Rajoir"],
      "Shib Char": ["Shib Char"],
      "Dasar": ["Dasar"]
    },
    "Rajbari": {
      "Baliakandi": ["Baliakandi"],
      "Goalanda": ["Goalanda"],
      "Kalukhali": ["Kalukhali"],
      "Pangsha": ["Pangsha"],
      "Rajbari Sadar": ["Rajbari Sadar"]
    },
    "Shariatpur": {
      "Bhedarganj": ["Bhedarganj"],
      "Damudya": ["Damudya"],
      "Gosairhat": ["Gosairhat"],
      "Naria": ["Naria"],
      "Shariatpur Sadar": ["Shariatpur Sadar"],
      "Zanjira": ["Zanjira"],
      "sakhipur": ["sakhipur"]
    }
  },
  "Mymensingh": {
    "Jamalpur": {
      "Jamalpur Sadar": ["Jamalpur Sadar"],
      "Madarganj": ["Madarganj"],
      "Sarishabari": ["Sarishabari", "Bhatara", "Kamrabad"],
      "Islampur": ["Islampur"],
      "Bakshiganj": ["Bakshiganj", "Nilakhia"],
      "Dewanganj": ["Dewanganj", "Bahadurabad", "Hatibanga", "Par ramrampur", "Chikajani"],
      "Melandaha": ["Melandaha"]
    },
    "Mymensingh": {
      "Bhaluka": ["Bhaluka"],
      "Fulbaria": ["Fulbaria", "Kushmail"],
      "Trishal": ["Trishal"],
      "Dhobaura": ["Dhobaura"],
      "Gaffargaon": ["Gaffargaon"],
      "Gauripur": ["Gauripur"],
      "Haluaghat": ["Haluaghat"],
      "Ishwarganj": ["Ishwarganj", "Maijbagh", "Jatia", "Magtula", "Rajibpur", "Borohit"],
      "Mymensingh Sadar": ["Mymensingh Sadar"],
      "Muktagachha": ["Muktagachha"],
      "Nandail": ["Nandail"],
      "Phulpur": ["Phulpur", "Sondhara", "Bhaitkandi"],
      "Tarakanda": ["Tarakanda", "Rampur Tarakanda", "Galagaon", "Dhakua", "Kamargaon", "Kakni", "Balikha", "Kamaria"]
    },
    "Netrakona": {
      "Netrokona Sadar": ["Netrokona Sadar"],
      "Durgapur": ["Durgapur"],
      "Atpara": ["Atpara"],
      "Barhatta": ["Barhatta"],
      "Khaliajuri": ["Khaliajuri"],
      "Kalmakanda": ["Kalmakanda"],
      "Kendua": ["Kendua"],
      "Madan": ["Madan", "Nayekpur", "Kaitail", "Chandgaw", "Teosree", "Fatepur"],
      "Mohanganj": ["Mohanganj", "Baraitali", "Baniyahari"],
      "Purbadhala": ["Purbadhala"]
    },
    "Sherpur": {
      "Nalitabari": ["Nalitabari"],
      "Nakla Sherpur": ["Nakla Sherpur", "pathakata", "Kobutormari", "Gonopoddi", "Urpha", "Chandrakona"],
      "Sherpur Sadar": ["Sherpur Sadar"],
      "Sreebardi": ["Sreebardi"],
      "Jhenaigati": ["Jhenaigati"]
    }
  },
  "Rongpur": {
    "Rongpur": {
      "Badarganj": ["Badarganj"]
    }
  },
  "Rangpur": {
    "Dinajpur": {
      "Fulbari": ["Fulbari"],
      "Birampur": ["Birampur"],
      "Birganj": ["Birganj"],
      "Khansama": ["Khansama"],
      "Nawabganj Dinajpur": ["Nawabganj Dinajpur"],
      "Dinajpur Sadar": ["Dinajpur Sadar"],
      "Ghoraghat": ["Ghoraghat"],
      "Biral": ["Biral"],
      "Bochaganj": ["Bochaganj"],
      "Chirirbandar": ["Chirirbandar"],
      "Hakimpur": ["Hakimpur"],
      "Kaharole": ["Kaharole"],
      "Parbatipur": ["Parbatipur"]
    },
    "Gaibandha": {
      "Fulchhari": ["Fulchhari"],
      "Gobindaganj": ["Gobindaganj"],
      "Sundarganj": ["Sundarganj"],
      "Palashbari": ["Palashbari"],
      "Sadullapur": ["Sadullapur"],
      "Saghata": ["Saghata"],
      "Gaibandha Sadar": ["Gaibandha Sadar"],
      "Ghoraghat": ["Ghoraghat"]
    },
    "Kurigram": {
      "Phulbari Sadar": ["Phulbari Sadar"],
      "Nageshwari": ["Nageshwari"],
      "Rajarhat": ["Rajarhat"],
      "Raumari": ["Raumari"],
      "Kurigram Sadar": ["Kurigram Sadar"],
      "Bhurungamari": ["Bhurungamari"],
      "Char Rajibpur": ["Char Rajibpur"],
      "Chilmari": ["Chilmari"],
      "Ulipur": ["Ulipur"]
    },
    "Lalmonirhat": {
      "Patgram": ["Patgram"],
      "Hatibandha": ["Hatibandha"],
      "Aditmari": ["Aditmari"],
      "Kaliganj Lalmonirhat": ["Kaliganj Lalmonirhat"],
      "Lalmonirhat Sadar": ["Lalmonirhat Sadar"]
    },
    "Nilphamari": {
      "Jaldhaka": ["Jaldhaka"],
      "Nilphamari Sadar": ["Nilphamari Sadar"],
      "Kishoreganj": ["Kishoreganj"],
      "Dimla": ["Dimla"],
      "Domar": ["Domar"],
      "Saidpur": ["Saidpur"]
    },
    "Rangpur": {
      "Rangpur Sadar": ["Rangpur Sadar", "Tajhat", "Kotwali Rangpur"],
      "Gangachara": ["Gangachara"],
      "Mithapukur": ["Mithapukur"],
      "Pirganj": ["Pirganj"],
      "Taraganj": ["Taraganj"],
      "Pirgachha": ["Pirgachha"],
      "Kaunia": ["Kaunia"],
      "Badarganj": ["Badarganj"]
    },
    "Thakurgaon": {
      "Pirganj (Thakurgaon)": ["Pirganj (Thakurgaon)"],
      "Baliadangi": ["Baliadangi"],
      "Haripur": ["Haripur"],
      "Ranisankail": ["Ranisankail"],
      "Thakurgaon Sadar": ["Thakurgaon Sadar"]
    },
    "Panchagarh": {
      "Atwari": ["Atwari"],
      "Boda": ["Boda"],
      "Debiganj": ["Debiganj"],
      "Panchagarh Sadar": ["Panchagarh Sadar"],
      "Tentulia": ["Tentulia"]
    }
  },
  "Rajshahi": {
    "Sirajganj": {
      "Sirajganj Sadar": ["Sirajganj Sadar"],
      "Belkuchi": ["Belkuchi"],
      "Royganj": ["Royganj"],
      "Shahjadpur": ["Shahjadpur"],
      "Tarash": ["Tarash"],
      "Ullah Para": ["Ullah Para"],
      "Chauhali": ["Chauhali"],
      "Kamarkhanda": ["Kamarkhanda"],
      "Kazipur": ["Kazipur"]
    },
    "Natore": {
      "Singra": ["Singra"],
      "Natore Sadar": ["Natore Sadar"],
      "Bagatipara": ["Bagatipara"],
      "Baraigram": ["Baraigram", "Bonpara"],
      "Gurudaspur": ["Gurudaspur"],
      "Lalpur": ["Lalpur"],
      "Naldanga": ["Naldanga"]
    },
    "Rajshahi": {
      "Rajshahi City Corporation": ["Bolia", "Matihar", "Rajpara", "Shah Makhdum", "Rajshahi Sadar", "Kashiadanga"],
      "Durgapur": ["Durgapur"],
      "Paba": ["Paba", "Nawhata"],
      "Charghat": ["Charghat"],
      "Baghmara": ["Baghmara"],
      "Mohanpur": ["Mohanpur"],
      "Bagha": ["Bagha"],
      "Godagari": ["Godagari"],
      "Puthia": ["Puthia"],
      "Tanore": ["Tanore"]
    },
    "Chapai Nawabganj": {
      "Chapai Nawabganj Sadar": ["Chapai Nawabganj Sadar"],
      "Shibganj Chapai Nawabganj": ["Shibganj Chapai Nawabganj"],
      "Bholahat": ["Bholahat"],
      "Gomastapur": ["Gomastapur"],
      "Nachole": ["Nachole"]
    },
    "Bogura": {
      "Bogura Sadar": ["Bogura Sadar"],
      "Gabtali": ["Gabtali"],
      "Sherpur Bogura": ["Sherpur Bogura"],
      "Shibganj Bogura": ["Shibganj Bogura"],
      "Sonatola": ["Sonatola"],
      "Dhunat": ["Dhunat"],
      "Adamdighi": ["Adamdighi"],
      "Dhupchanchia": ["Dhupchanchia"],
      "Kahaloo": ["Kahaloo"],
      "Nandigram": ["Nandigram"],
      "Sariakandi": ["Sariakandi"],
      "Shajahanpur": ["Shajahanpur"]
    },
    "Joypurhat": {
      "Kalai": ["Kalai"],
      "Joypurhat Sadar": ["Joypurhat Sadar"],
      "Akkelpur": ["Akkelpur"],
      "Khetlal": ["Khetlal"],
      "Panchbibi": ["Panchbibi"]
    },
    "Pabna": {
      "Atgharia": ["Atgharia"],
      "Pabna Sadar": ["Pabna Sadar"],
      "Chatmohar": ["Chatmohar"],
      "Bera": ["Bera"],
      "Bhangura": ["Bhangura"],
      "Faridpur Pabna": ["Faridpur Pabna"],
      "Ishwardi": ["Ishwardi"],
      "Santhia": ["Santhia"],
      "Sujanagar": ["Sujanagar"]
    },
    "Naogaon": {
      "Atrai": ["Atrai"],
      "Dhamoirhat": ["Dhamoirhat"],
      "Patnitala": ["Patnitala"],
      "Raninagar": ["Raninagar"],
      "Sapahar": ["Sapahar"],
      "Niamatpur": ["Niamatpur"],
      "Naogaon Sadar": ["Naogaon Sadar"],
      "Badalgachhi": ["Badalgachhi"],
      "Manda": ["Manda"],
      "Mahadebpur": ["Mahadebpur"],
      "Porsha": ["Porsha"]
    }
  },
  "Khulna": {
    "Sathkhira": {
      "Dhamoirhat": ["Dhamoirhat"],
      "Patkelghata": ["Patkelghata"],
      "Tala": ["Tala"],
      "Kaliganj Sathkhira": ["Kaliganj Sathkhira"],
      "Assasuni": ["Assasuni"],
      "Debhata": ["Debhata"],
      "Kalaroa": ["Kalaroa"],
      "Satkhira Sadar": ["Satkhira Sadar"],
      "Shyamnagar": ["Shyamnagar"]
    },
    "Khulna": {
      "Paikgachha": ["Paikgachha"],
      "Batiaghata": ["Batiaghata"],
      "Dumuria": ["Dumuria"],
      "Khulna City Corporation": ["Daulatpur Khulna", "Khalishpur", "Khan Jahan Ali", "Khulna Sadar", "Sonadanga", "Labanchara"],
      "Dacope": ["Dacope"],
      "Dighalia": ["Dighalia"],
      "Koyra": ["Koyra"],
      "Phultala": ["Phultala"],
      "Rupsa": ["Rupsa"],
      "Terokhada": ["Terokhada"]
    },
    "Jessore": {
      "Jhikorgachha": ["Jhikorgachha"],
      "Keshabpur": ["Keshabpur"],
      "Jessore Sadar": ["Jessore Sadar"],
      "Manirampur": ["Manirampur"],
      "Sharsha": ["Sharsha"],
      "Abhaynagar": ["Abhaynagar"],
      "Bagherpara": ["Bagherpara"],
      "Chaugachha": ["Chaugachha"],
      "Jhikargachha": ["Jhikargachha"]
    },
    "Jhenaidah": {
      "Kotchandpur": ["Kotchandpur"],
      "Jhenaidah Sadar": ["Jhenaidah Sadar"],
      "Moheshpur": ["Moheshpur"],
      "Kaliganj Jhenaidah": ["Kaliganj Jhenaidah"],
      "Harinakundu": ["Harinakundu"],
      "Maheshpur": ["Maheshpur"],
      "Shailkupa": ["Shailkupa"]
    },
    "Kushtia": {
      "Kushtia Sadar": ["Kushtia Sadar"],
      "Khoksha": ["Khoksha"],
      "Bheramara": ["Bheramara"],
      "Kumarkhali": ["Kumarkhali"],
      "Dawlatpur": ["Dawlatpur"],
      "Daulatpur Kushtia": ["Daulatpur Kushtia"],
      "Khoksa": ["Khoksa"],
      "Mirpur Kushtia": ["Mirpur Kushtia"]
    },
    "Chuadanga": {
      "Damurhuda": ["Damurhuda"],
      "Chuadanga Sadar": ["Chuadanga Sadar"],
      "Alamdanga": ["Alamdanga"],
      "Jibonnagar": ["Jibonnagar"],
      "Jiban Nagar": ["Jiban Nagar"]
    },
    "Meherpur": {
      "Gangni": ["Gangni"],
      "Mujib Nagar": ["Mujib Nagar"],
      "Meherpur Sadar": ["Meherpur Sadar"]
    },
    "Bagerhat": {
      "Kachua Bagerhat": ["Kachua Bagerhat"],
      "Bagerhat Sadar": ["Bagerhat Sadar"],
      "Chitalmari": ["Chitalmari"],
      "Fakirhat": ["Fakirhat"],
      "Mollahat": ["Mollahat"],
      "Mongla": ["Mongla"],
      "Morrelganj": ["Morrelganj"],
      "Rampal": ["Rampal"],
      "Sarankhola": ["Sarankhola"]
    },
    "Narail": {
      "Lohagara Narail": ["Lohagara Narail"],
      "Kalia": ["Kalia"],
      "Narail Sadar": ["Narail Sadar"]
    },
    "Magura": {
      "Magura Sadar": ["Magura Sadar"],
      "Shalikha": ["Shalikha"],
      "Mohammadpur Magura": ["Mohammadpur Magura"],
      "Sreepur Magura": ["Sreepur Magura"]
    }
  },
  "Barisal": {
    "Barishal": {
      "Wazirpur": ["Wazirpur"]
    },
    "Barguna": {
      "Amtali": ["Amtali"],
      "Bamna": ["Bamna"],
      "Barguna Sadar": ["Barguna Sadar"],
      "Betagi": ["Betagi"],
      "Patharghata": ["Patharghata"],
      "Taltali": ["Taltali"]
    },
    "Barisal": {
      "Agailjhara": ["Agailjhara"],
      "Babuganj": ["Babuganj"],
      "Bakerganj": ["Bakerganj"],
      "Banari Para": ["Banari Para"],
      "Gaurnadi": ["Gaurnadi"],
      "Hizla": ["Hizla"],
      "Kotwali Barisal": ["Kotwali Barisal"],
      "Mehendiganj": ["Mehendiganj"],
      "Muladi": ["Muladi"],
      "Wazirpur": ["Wazirpur"],
      "Barisal Sadar": ["Barisal Sadar"]
    },
    "Bhola": {
      "Bhola Sadar": ["Bhola Sadar"],
      "Burhanuddin": ["Burhanuddin"],
      "Char Fasson": ["Char Fasson"],
      "Daulat Khan": ["Daulat Khan"],
      "Lalmohan": ["Lalmohan"],
      "Manpura": ["Manpura"],
      "Tazumuddin": ["Tazumuddin"]
    },
    "Jhalokati": {
      "Jhalokati Sadar": ["Jhalokati Sadar"],
      "Kanthalia": ["Kanthalia"],
      "Nalchity": ["Nalchity"],
      "Rajapur": ["Rajapur"]
    },
    "Patuakhali": {
      "Bauphal": ["Bauphal"],
      "Dashmina": ["Dashmina"],
      "Dumki": ["Dumki"],
      "Galachipa": ["Galachipa"],
      "Kala Para": ["Kala Para"],
      "Mirzaganj": ["Mirzaganj"],
      "Patuakhali Sadar": ["Patuakhali Sadar"]
    },
    "Pirojpur": {
      "Bhandaria": ["Bhandaria"],
      "Mathbaria": ["Mathbaria", "Baramasua"],
      "Nazirpur": ["Nazirpur"],
      "Pirojpur Sadar": ["Pirojpur Sadar"],
      "Nesarabad": ["Nesarabad"],
      "Zianagar": ["Zianagar"],
      "Kawkhali": ["Kawkhali"],
      "Indurkani": ["Indurkani"]
    }
  },
  "Chittagong": {
    "Chittagong": {
      "Pahartoli": ["Pahartoli"],
      "Sitakundu": ["Sitakundu"],
      "Anowara": ["Anowara"],
      "Chittagong City Corporation": ["Bakalia", "Bayejid Bostami", "Chandgaon", "Chittagong Port", "Double Mooring", "Halishahar", "Hathazari", "Khulshi", "Pahartali", "Panchlaish", "Patenga", "Kotwali Chittagong", "Chittagong Sadar", "Chawkbazar", "Akbarshah", "Karnaphuli", "Agrabad"],
      "Banshkhali": ["Banshkhali"],
      "Boalkhali": ["Boalkhali"],
      "Chandanaish": ["Chandanaish"],
      "Fatikchhari": ["Fatikchhari", "Bhujpur"],
      "Mirsharai": ["Mirsharai", "Karerhat"],
      "Patiya": ["Patiya"],
      "Rangunia": ["Rangunia"],
      "Raozan": ["Raozan"],
      "Sandwip": ["Sandwip"],
      "Satkania": ["Satkania"],
      "Lohagara Chittagong": ["Lohagara Chittagong"],
      "Nizampur": ["Nizampur"],
      "Baraiyarhat": ["Baraiyarhat"],
      "Zorawarganj": ["Zorawarganj"]
    },
    "Bandarban": {
      "Alikadam": ["Alikadam"],
      "Bandarban Sadar": ["Bandarban Sadar"],
      "Lama": ["Lama"],
      "Naikhongchhari": ["Naikhongchhari"],
      "Rowangchhari": ["Rowangchhari"],
      "Ruma": ["Ruma"],
      "Thanchi": ["Thanchi"]
    },
    "Brahmanbaria": {
      "Akhaura": ["Akhaura"],
      "Banchharampur": ["Banchharampur"],
      "Bijoynagar": ["Bijoynagar"],
      "Brahmanbaria Sadar": ["Brahmanbaria Sadar"],
      "Ashuganj": ["Ashuganj"],
      "Kasba": ["Kasba"],
      "Nabinagar": ["Nabinagar"],
      "Nasirnagar": ["Nasirnagar"],
      "Sarail": ["Sarail"]
    },
    "Chandpur": {
      "Chandpur Sadar": ["Chandpur Sadar"],
      "Faridganj": ["Faridganj"],
      "Haim Char": ["Haim Char"],
      "Hajiganj": ["Hajiganj"],
      "Matlab": ["Matlab"],
      "Matlab Uttar": ["Matlab Uttar"],
      "Shahrasti": ["Shahrasti"],
      "Kachua Chandpur": ["Kachua Chandpur"],
      "Matlab Dakshin": ["Matlab Dakshin"],
      "Baburhat": ["Baburhat"]
    },
    "Comilla": {
      "Barura": ["Barura"],
      "Brahmanpara": ["Brahmanpara"],
      "Burichang": ["Burichang"],
      "Chandina": ["Chandina"],
      "Chauddagram": ["Chauddagram"],
      "Comilla Sadar Dakshin": ["Comilla Sadar Dakshin"],
      "Daudkandi": ["Daudkandi"],
      "Debidwar": ["Debidwar"],
      "Homna": ["Homna"],
      "Comilla Adarsha Sadar": ["Kotwali Comilla", "Comilla Adarsha Sadar"],
      "Laksam": ["Laksam"],
      "Manoharganj": ["Manoharganj"],
      "Meghna": ["Meghna"],
      "Muradnagar": ["Muradnagar"],
      "Nangalkot": ["Nangalkot"],
      "Titas": ["Titas"],
      "Comilla City Corporation": ["Comilla Sadar"],
      "Companiganj Comilla": ["Companiganj Comilla"],
      "Lalmai": ["Lalmai"]
    },
    "Cox's Bazar": {
      "Chakoria": ["Chakoria"],
      "Cox's Bazar Sadar": ["Cox's Bazar Sadar"],
      "Kutubdia": ["Kutubdia"],
      "Maheshkhali": ["Maheshkhali"],
      "Pekua": ["Pekua"],
      "Ramu": ["Ramu"],
      "Teknaf": ["Teknaf"],
      "Ukhia": ["Ukhia"],
      "Eidgah": ["Eidgah"]
    },
    "Feni": {
      "Chhagalnaiya": ["Chhagalnaiya"],
      "Daganbhuiyan": ["Daganbhuiyan"],
      "Feni Sadar": ["Feni Sadar"],
      "Fulgazi": ["Fulgazi"],
      "Parshuram": ["Parshuram"],
      "Sonagazi": ["Sonagazi"]
    },
    "Khagrachhari": {
      "Dighinala": ["Dighinala"],
      "Khagrachhari Sadar": ["Khagrachhari Sadar"],
      "Lakshmichhari": ["Lakshmichhari"],
      "Mahalchhari": ["Mahalchhari"],
      "Manikchhari": ["Manikchhari"],
      "Matiranga": ["Matiranga"],
      "Panchhari": ["Panchhari"],
      "Ramgarh": ["Ramgarh"]
    },
    "Lakshmipur": {
      "Kamalnagar": ["Kamalnagar"],
      "Lakshmipur Sadar": ["Lakshmipur Sadar", "Chandraganj"],
      "Roypur": ["Roypur"],
      "Ramganj": ["Ramganj"],
      "Ramgati": ["Ramgati"],
      "Kachua Lakshmipur": ["Kachua Lakshmipur"]
    },
    "Noakhali": {
      "Begumganj": ["Begumganj"],
      "Chatkhil": ["Chatkhil"],
      "Companiganj Noakhali": ["Companiganj Noakhali"],
      "Hatiya": ["Hatiya"],
      "Kabirhat": ["Kabirhat"],
      "Senbagh": ["Senbagh"],
      "Sonaimuri": ["Sonaimuri"],
      "Subarnachar": ["Subarnachar"],
      "Noakhali Sadar": ["Noakhali Sadar"]
    },
    "Rangamati": {
      "Baghaichhari": ["Baghaichhari"],
      "Barkal": ["Barkal"],
      "Belai Chhari": ["Belai Chhari"],
      "Kaptai": ["Kaptai"],
      "Jurai Chhari": ["Jurai Chhari"],
      "Langadu": ["Langadu"],
      "Naniarchar": ["Naniarchar"],
      "Rajasthali": ["Rajasthali"],
      "Rangamati Sadar": ["Rangamati Sadar"],
      "Kawkhali": ["Kawkhali"]
    }
  },
  "Sylhet": {
    "Habiganj": {
      "Ajmiriganj": ["Ajmiriganj"],
      "Bahubal": ["Bahubal"],
      "Baniachong": ["Baniachong"],
      "Chunarughat": ["Chunarughat"],
      "Habiganj Sadar": ["Habiganj Sadar"],
      "Lakhai": ["Lakhai"],
      "Madhabpur": ["Madhabpur"],
      "Nabiganj": ["Nabiganj"],
      "Shayestaganj": ["Shayestaganj"]
    },
    "Maulvibazar": {
      "Barlekha": ["Barlekha"],
      "Juri": ["Juri"],
      "Kamalganj": ["Kamalganj"],
      "Kulaura": ["Kulaura"],
      "Maulvibazar Sadar": ["Maulvibazar Sadar"],
      "Rajnagar": ["Rajnagar"],
      "Sreemangal": ["Sreemangal"]
    },
    "Sunamganj": {
      "Bishwambarpur": ["Bishwambarpur"],
      "Chhatak": ["Chhatak"],
      "Dakshin Sunamganj": ["Dakshin Sunamganj"],
      "Derai": ["Derai"],
      "Dharampasha": ["Dharampasha"],
      "Dowarabazar": ["Dowarabazar"],
      "Jagannathpur": ["Jagannathpur"],
      "Jamalganj": ["Jamalganj"],
      "Sulla": ["Sulla"],
      "Sunamganj Sadar": ["Sunamganj Sadar"],
      "Tahirpur": ["Tahirpur"]
    },
    "Sylhet": {
      "Balaganj": ["Balaganj"],
      "Beani Bazar": ["Beani Bazar"],
      "Bishwanath": ["Bishwanath"],
      "Companiganj Sylhet": ["Companiganj Sylhet"],
      "Dakshin Surma": ["Dakshin Surma"],
      "Fenchuganj": ["Fenchuganj"],
      "Golapganj": ["Golapganj"],
      "Gowainghat": ["Gowainghat"],
      "Jaintiapur": ["Jaintiapur"],
      "Kanaighat": ["Kanaighat"],
      "Sylhet Sadar": ["Sylhet Sadar"],
      "Zakiganj": ["Zakiganj"]
    }
  }
};

if (typeof window !== 'undefined') {
  window.BD_LOCATIONS = BD_LOCATIONS;
}