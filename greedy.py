import pandas as pd
import argparse, json, re
from datetime import datetime, timedelta
import math
import time

# Parse command line arguments
parser = argparse.ArgumentParser()
parser.add_argument('limit', nargs='?', type=int, default=None, help='Limit number of students to process')
args = parser.parse_args()

# Read config
with open('config.json', 'r') as f:
    config = json.load(f)

C = config.get('C', 5)
D = config.get('D', 3)
H = config.get('H', 9)
M = config.get('M', 7)
R = config.get('R', 3)
start_date_str = config.get('start_date')

# Debug: print start_date to stderr so it doesn't interfere with JSON output
import sys
print(f"DEBUG: start_date_str from config = {start_date_str}", file=sys.stderr)

# ================================================FUNCTION=========================================
def compute_npref(pref):
    # daftar per dosen: jumlah slot yang tersedia
    return [sum(dosen) for dosen in pref]


    # students: list of dict {id, Type, PB}
    # npref: list atau dict
    # nstu: dict {pb: jumlah mhs}
def sort_with_type( npref, nstu):
    students = stu_df.to_dict(orient="records")
    # Normalisasi npref jadi dict
    if not isinstance(npref, dict):
        npref = {i: v for i, v in enumerate(npref)}
    # Normalisasi nstu (kalau ada dosen tanpa mahasiswa = 0)
    for a in range(len(npref)):
        nstu.setdefault(a, 0)
    
    # Step 1+2: sort dosen berdasarkan (npref, nstu)
    supervisors_sorted = sorted(
        npref.keys(),
        key=lambda a: (npref[a], nstu[a], a)
    )
    
    # Step 3: untuk tiap dosen, ambil mahasiswa dan urutkan by type
    schedule = []
    for sup in supervisors_sorted:
        mhs = [s for s in students if s["PB"] == sup]
        mhs_sorted = sorted(mhs, key=lambda s: (s["Type"], s["stuID"]))
        schedule.extend(mhs_sorted)
    
    return schedule

def supervisor_available(time_pref, supervisor_id, slot_index, M=7, R=3, H=9):
    """
    time_pref[a][slot] == 1 artinya dosen a tersedia pada slot tersebut.
    slot_index sekarang sudah dalam range 0-62 (slot per hari untuk semua hari)
    """
    try:
        # slot_index sudah 0-62, langsung pakai
        slot_hari = slot_index
        return int(time_pref[supervisor_id][slot_hari]) == 1
    except Exception:
        return False


def check_supervisor_conflict(Schedule, timeslots, curr, supervisor_id):
    slot = timeslots[curr]['slot']  # now 0-62
    room = timeslots[curr]['ruang']
    
    # Calculate day and slot_in_day from slot (0-62)
    curr_day = slot // M
    curr_slot_in_day = slot % M
    
    for idx, ts in enumerate(timeslots):
        if idx == curr:
            continue
        s = ts['slot']  # 0-62
        r = ts['ruang']
        day = s // M
        s_in_day = s % M
        if day == curr_day and s_in_day == curr_slot_in_day and r != room:
            if supervisor_id in Schedule[idx]["supervisors"]:
                return False
    return True

def reset_schedule(Schedule):
    for i in Schedule:
        Schedule[i]["students"].clear()
        Schedule[i]["supervisors"].clear()
        
def greedy_schedule(sorted_students_df, timeslots, time_pref, C, Schedule):
    unassigned_students = []
    assigned_nims = set()  # Track assigned students by NIM to prevent duplicates
    
    for s in sorted_students_df.to_dict(orient="records"):
        supervisor_id = s['PB']
        student_nim = safe_get(s, ["NIM"])
        
        # Skip if this student is already assigned
        if student_nim in assigned_nims:
            continue
        
        assigned = False

        #  alasan unik (tanpa spam detail slot/hari)
        reason_set = set()

        for i in range(len(timeslots)):
            timeslot = timeslots[i]
            slot = timeslot['slot']
            room = timeslot['ruang']

            curr_day = slot // M
            curr_slot_in_day = slot % M

            # Cek constraints
            
            is_capacity_available = (len(Schedule[i]['students']) < C)
            
            is_supervisor_avail = supervisor_available(time_pref, supervisor_id, slot, M, R)
            is_conflict_free = check_supervisor_conflict(Schedule, timeslots, i, supervisor_id)

            if is_capacity_available and is_supervisor_avail and is_conflict_free:
                Schedule[i]['students'].append(s)
                Schedule[i]['supervisors'].add(supervisor_id)
                if student_nim:
                    assigned_nims.add(student_nim)  # Mark this student as assigned
                assigned = True
                break
            else:
                if not is_capacity_available:
                    reason_set.add("penuh")
                if not is_supervisor_avail:
                    reason_set.add("pref!=")  # tidak cocok waktu dosen
                if not is_conflict_free:
                    reason_set.add("konflik dosen")

        if not assigned:
            s_copy = s.copy()
            order = ["penuh", "pref!=", "konflik dosen"]
            reasons_sorted = [r for r in order if r in reason_set] + [r for r in reason_set if r not in order]
            s_copy['alasan_unassigned'] = ", ".join(reasons_sorted) if reasons_sorted else "tidak diketahui"
            s_copy['time_preference'] = time_pref[supervisor_id] if supervisor_id < len(time_pref) else []
            unassigned_students.append(s_copy)

    return Schedule, unassigned_students

def compute_greedy_objectives(schedule, timeslots, H, M):
    obj2_same_type_pairs = 0
    used_slots = set()   # kumpulkan slot (tanpa lihat ruangan) yang terpakai

    for i, info in schedule.items():
        studs = info.get("students", [])
        if not studs:
            continue

        # slot global (0..H*M-1) – ruangan beda tetap slot yg sama
        slot_global = timeslots[i]['slot']
        used_slots.add(slot_global)

        # hitung pasangan bertipe sama
        # mirip:
        # for j in range(n-1):
        #   for k in range(j+1, n):
        n = len(studs)
        for j in range(n - 1):
            for k in range(j + 1, n):
                same_type = 1 if studs[j].get("Type") == studs[k].get("Type") else 0
                obj2_same_type_pairs += same_type

    # Objective 3 versi Gurobi: m - sum(s[i])
    # total timeslot dikurangin used slots
    total_possible_slots = len(timeslots)
    obj3_min_used_timeslots = total_possible_slots - len(used_slots)

    return {
        "obj2_same_type_pairs": obj2_same_type_pairs,
        "obj3_min_used_timeslots": obj3_min_used_timeslots,
        "used_slots_count": len(used_slots),
    }

def to_serializable(o):
    # set → list
    if isinstance(o, set):
        return list(o)
    # numpy / pandas scalar (jaga-jaga)
    try:
        import numpy as np
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o) if not np.isnan(o) else None  # replace NaN with None
    except Exception:
        pass
    # pandas NaN
    if pd.isna(o):
        return None
    # fallback
    return str(o)


def safe_get(s, keys, default="-"):
    for key in keys:
        val = s.get(key)
        if val is not None and not pd.isna(val):
            return str(val)
    return default


def additional_supervisors():
    count_dosen_passed = 0
    for i in range(len(timeslots)):
        timeslot = timeslots[i]
        slot = timeslot['slot']

        if len(Schedule[i]['students']) > 0:  # sesi aktif
            while len(Schedule[i]["supervisors"]) < D:
                for dosen in stu_df['PB'].unique():
                    # print("curr dosen viewing: ", dosen )
                    is_dosen_in_schedule = dosen not in Schedule[i]['supervisors'] #cek apakah dosen belum di sesi sekarang
                    is_supervisor_avail = supervisor_available(pref, dosen, slot, M, R)
                    is_conflict_free = check_supervisor_conflict(Schedule, timeslots, i, dosen)
                    if is_dosen_in_schedule and is_supervisor_avail and is_conflict_free and len(Schedule[i]["supervisors"]) < D:
                        Schedule[i]['supervisors'].add(dosen)
                        # print("add in schedule",i, Schedule[i]['supervisors'])
                break


def schedule_to_dataframe(schedule, timeslots, seminar_dates=None,M=7, R=3, H=9, slot_is_per_room=False):
    slot_map = {
        0: "08:00-09:00",
        1: "09:00-10:00",
        2: "10:00-11:00",
        3: "11:00-12:00",
        4: "13:00-14:00",
        5: "14:00-15:00",
        6: "15:00-16:00",
        # kalau memang hanya 7 slot per hari, jangan pakai index 7:
        # 7: "16:00-17:00",
    }
    mbkm_map = {"Magang": 0, "Stupen": 1, "Penelitian":2, "Mengajar": 3, "KKN": 4, "Wirausaha": 5}
    rows = []
    for i, info in schedule.items():
        if not info.get('students'):
            continue
        room        = timeslots[i]['ruang']
        global_slot = timeslots[i]['slot']
        if slot_is_per_room:
            # slot dihitung per ruang (0..M*R*H-1)
            day_idx     =  (global_slot // (M * R))
            slot_in_day = ((global_slot %  (M * R)) // R)
        else:
            # slot sudah base slot (0..M*H-1)
            day_idx     =  (global_slot // M)
            slot_in_day =  (global_slot %  M)
        if day_idx >= H:
            continue
        # Label hari + tanggal
        if seminar_dates and day_idx < len(seminar_dates):
            di = seminar_dates[day_idx]
            hari_label = f"Hari ke-{day_idx + 1}: {di['day_name']}, {di['formatted_date']}"
        else:
            hari_label = f"Hari ke-{day_idx + 1}"

        slot_label = slot_map.get(slot_in_day, f"Slot {slot_in_day + 1}")
        room_label = f"R{room + 1}"

        # Supervisors (gabungan semua dosen yang hadir)
        supervisors_list = []
        for d in info.get("supervisors", []):
            row = stu_df.loc[stu_df["PB"] == d, "PEMBIMBING"]
            if not row.empty:
                val = row.iloc[0]
                if pd.isna(val):
                    supervisors_list.append(f"PB-{d}")
                else:
                    supervisors_list.append(str(val))
            else:
                supervisors_list.append(f"PB-{d}")
        supervisors_str = ";".join(supervisors_list) if supervisors_list else "-"

        # Baris per mahasiswa
        for s in info.get("students", []):
            nim   = safe_get(s, ["NIM"])
            nama  = safe_get(s, ["NAMA", "Nama", "name"])
            tipe  = safe_get(s, ["MBKM"])
            pemb  = safe_get(s, ["PEMBIMBING"])

            rows.append({
                "Hari": hari_label,
                "Slot": slot_label,
                "Ruangan": room_label,
                "NIM": nim,
                "Nama": nama,
                "Type": tipe,
                "Pembimbing": pemb,
                "Dosen yang Hadir": supervisors_str,
            })

    # memastikan semua hari 1 sampai H ada, bahkan kosong
    existing_days = set()
    for r in rows:
        match = re.search(r'Hari ke-(\d+)', r['Hari'])
        if match:
            existing_days.add(int(match.group(1)) - 1)

    for day_idx in range(H):
        if day_idx not in existing_days:
            # Tambahkan baris kosong untuk hari ini
            if seminar_dates and day_idx < len(seminar_dates):
                di = seminar_dates[day_idx]
                hari_label = f"Hari ke-{day_idx + 1}: {di['day_name']}, {di['formatted_date']}"
            else:
                hari_label = f"Hari ke-{day_idx + 1}"
            rows.append({
                "Hari": hari_label,
                "Slot": "-",
                "Ruangan": "-",
                "NIM": "-",
                "Nama": "-",
                "Type": "-",
                "Pembimbing": "-",
                "Dosen yang Hadir": "-",
            })

    # Sort rows by day_idx
    def get_day_idx(row):
        match = re.search(r'Hari ke-(\d+)', row['Hari'])
        return int(match.group(1)) - 1 if match else 999

    rows.sort(key=get_day_idx)

    return pd.DataFrame(rows, columns=["Hari", "Slot", "Ruangan", "NIM", "Nama", "Type", "Pembimbing", "Dosen yang Hadir"])






# =========================================================================================


# C = kapasitas maksimal mahasiswa per ruangan (form)
# C = 5
# D = minimal jumlah dosen per sesi
# D = 3
# H = jumlah hari seminar diinginkan (form)
# H = 9
# M = jumlah slot per hari 
# M = 7
# R = jumlah ruangan (form)
# R = 3
# start_date_str = args.start_date



stu_df = pd.read_excel("uploads/stu.xlsx")

# Remove duplicate students based on NIM to ensure unique students
initial_count = len(stu_df)
stu_df = stu_df.drop_duplicates(subset=['NIM'], keep='first')
removed_duplicates = initial_count - len(stu_df)
if removed_duplicates > 0:
    print(f"[INFO] Removed {removed_duplicates} duplicate student(s) based on NIM", file=sys.stderr)
    print(f"[INFO] Unique students: {len(stu_df)}", file=sys.stderr)

# Limit students if specified
if args.limit is not None:
    stu_df = stu_df.head(args.limit)


# NIM -> stuID (index 0...)
stu_df = stu_df.reset_index(drop=True)
stu_df["stuID"] = stu_df.index


# membuat kolom kosong sesuai dengan PB, dan encoding
# Pembimbing -> PB
stu_df_copy = stu_df.copy()  
currPB = None
pb_list = []
for i, pembimbing in stu_df_copy["PEMBIMBING"].items():
    if pd.notna(pembimbing):     # kalau bukan unknown
        currPB = pembimbing
    else:                        # kalau unknown
        stu_df_copy.at[i, "PEMBIMBING"] = currPB
    pb_list.append(currPB)
stu_df_copy["PB_raw"] = pb_list

# mapping pembimbing → angka unik (encoding)
pb_map = {pb: idx for idx, pb in enumerate(pd.Series(pb_list).dropna().unique())}
stu_df_copy["PB"] = stu_df_copy["PB_raw"].map(pb_map).fillna(0).astype(int)
stu_df["PB"] = stu_df_copy["PB"].values
stu_df["PEMBIMBING"] = stu_df_copy["PEMBIMBING"].values 

# print(stu_df["PB"].unique() )


# MBKM -> Type (mapping 0-5)
mbkm_map = {"Magang": 0, "Stupen": 1, "Penelitian":2, "Mengajar": 3, "KKN": 4, "Wirausaha": 5} 
stu_df["Type"] = stu_df["MBKM"].map(mbkm_map).fillna(-1).astype(int)

# print(stu_df["Type"].unique())
# [0 1 2 3 4 5]

# print(stu_df[["NAMA","PEMBIMBING","PB"]])
#                     NAMA                                  PEMBIMBING  PB
# 0          JASON PERMANA  Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.   0
# 1    ARYA WIRA KRISTANTO  Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.   0
# 2        NICHOLAS MARTIN  Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.   0
# 3             FINNIA LI   Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.   0
# 4      KEVIN JONATHAN JM  Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.   0
# ..                   ...                                         ...  ..
# 330      ARMANTA TARIGAN                 Tony, S.Kom., M.Kom., Ph.D.  21
# 331  GERRANT ENRIQO HIYA                 Tony, S.Kom., M.Kom., Ph.D.  21
# 332       AMARA THURIDHA                 Tony, S.Kom., M.Kom., Ph.D.  21
# 333           AHMAD RORY                 Tony, S.Kom., M.Kom., Ph.D.  21
# 334        ANDRI RIZKIKA                 Tony, S.Kom., M.Kom., Ph.D.  21

# print(stu_df["PEMBIMBING"].unique().shape[0])
# ['Prof. Dr. Ir. Dyah Erny Herwindiati, M.Si.'
#  'Ir. Jap Tji Beng, MMSI, M.Psi., Ph.D., PE, M.ASCE'
#  'Lely Hiryanto, ST, M.Sc., Ph.D' 'Darius Andana Haris, S.Kom., MTI'
#  'Ir. Jeanny Pragantha, M.Eng.' 'Janson Hendryli, S.Kom., M.Kom.'
#  'Dr. Ing. Agus Budi Dharmawan, S.Kom., MT, M.Sc.'
#  'Novario Jaya Perdana, S.Kom., MT' 'Desi Arisandi, S.Kom., MTI'
#  'Tri Sutrisno, S.Si., M.Sc.' 'Dr. Wasino, S.Kom., M.Kom.'
#  'Dra. Ery Dewayani, MMSI' 'Dr. Dedi Trisnawarman, S.Si., M.Kom.'
#  'Bagus Mulyawan, S.Kom., MM' 'Manatap Dolok Lauro, S.Kom., MMSI'
#  'Dra. Chairisni Lubis, M.Kom.' 'Prof. Lina, ST, M.Kom., Ph.D.'
#  'Viny Christanti Mawardi, S.Kom., M.Kom.'
#  'Teny Handhayani, S.Kom., M.Kom., Ph.D.' 'Irvan Lewenusa, S.Kom., M.Kom.'
#  'Herman Tusiadi, S.Kom., MM' 'Tony, S.Kom., M.Kom., Ph.D.']

# pref = [
#     [ #dosen 0 .
#         [1,1,1,0,0,0], # hari 1
#         [0,1,1,0,0,0],  # hari 2
#         [0,0,0,1,1,1]
#     ],
#     [ #dosen 1 .
#         [0,1,1,0,1,0], # hari 1
#         [1,0,0,1,0,1],  # hari 2
#         [1,1,0,0,0,1]
#     ]]

# df_pref = pd.read_csv("uploads/timePref.csv")


# print(stu_df[['NAMA', 'PEMBIMBING', 'PB']].head())
# print(dos_df.head())


#=========================================================================timepref

pref_df = pd.read_csv("uploads/pref.csv", header=None)

# Membuat mapping dari PEMBIMBING ke PB dari stu_df
pembimbing_to_pb = stu_df.set_index('PEMBIMBING')['PB'].to_dict()

# Menambahkan kolom PB ke pref_df berdasarkan kolom PEMBIMBING (kolom 0)
pref_df['PB'] = pref_df[0].map(pembimbing_to_pb)

# Urutkan pref_df berdasarkan kolom PB
pref_df = pref_df.sort_values('PB').reset_index(drop=True)

# Drop kolom PB dan kolom 0 (PEMBIMBING)
if pref_df.iloc[:, 0].dtype == object:
    pref_df = pref_df.drop(columns=[0])
pref_df = pref_df.drop(columns=['PB'])

# Konversi pref_df ke format list of lists untuk digunakan dalam algoritma
pref = pref_df.values.tolist()

# print("pref shape:", len(pref), "supervisors x", len(pref[0]) if pref else 0, "slots")


# =========================================================================timepref
# Generate timeslots
timeslots = []

# Generate timeslots
timeslots = []
for slot in range(H * M):  # 0 to 62 (H*M-1)
    for r in range(R):     # 0,1,2
        timeslots.append({
            'slot': slot,  # slot in day range 0-62
            'ruang': r
        })

# print("Total timeslots:", len(timeslots))
# print("Sample timeslots:", timeslots)

# Inisialisasi jadwal kosong
Schedule = {
    i: {
        "students": [],         # daftar mahasiswa yang masuk ke timeslot i
        "supervisors": set(),    # pakai set agar tidak ada duplikasi dosen
    }
    for i in range(len(timeslots))
}


    
    

nstu = stu_df.groupby("PB")["stuID"].count().sort_values().to_dict()
# print("nstu: ",nstu)
# nstu:  {5: 2, 6: 3, 2: 5, 3: 5, 4: 5, 0: 6, 1: 9}


result = sort_with_type(compute_npref(pref), nstu)
sorted_students_df = pd.DataFrame(result)
# schedule = greedy_schedule(sorted_students_df, timeslots, sessions, pref, C, Schedule)
# print("Final Schedule:", schedule)
# Final Schedule: {0: {'students': [{'stuID': 1, 'Type': 0, 'PB': 0}, ....

# Get unique PB in order of appearance
unique_pb_ordered = sorted_students_df["PB"].drop_duplicates().tolist()
sorted_lecturers = [stu_df[stu_df["PB"] == pb]["PEMBIMBING"].iloc[0] for pb in unique_pb_ordered]

start_time = time.time()

result, unassigned = greedy_schedule(
    sorted_students_df, timeslots, pref, C, Schedule
)
additional_supervisors()

end_time = time.time()
execution_time = end_time - start_time

# Count unique assigned students by NIM to avoid counting duplicates
assigned_nims = set()
for slot_info in result.values():
    for student in slot_info.get("students", []):
        nim = safe_get(student, ["NIM"])
        if nim:
            assigned_nims.add(nim)

assigned_count = len(assigned_nims)
unassigned_count = len(unassigned)

# Function to create dataframe for unassigned students
def unassigned_to_dataframe(unassigned_students):
    rows = []
    for s in unassigned_students:
        nim = safe_get(s, ["NIM"])
        nama = safe_get(s, ["NAMA", "Nama", "name"])
        mbkm_label = safe_get(s, ["MBKM"])
        Pemb = safe_get(s, ["PEMBIMBING"])
        alasan = s.get("alasan_unassigned", "-")
        time_pref = s.get("time_preference", [])
        
        # Convert time preference list to readable string
        time_pref_str = ",".join(map(str, time_pref)) if time_pref else "-"
        
        rows.append({
            "NIM": nim,
            "Nama": nama,
            "Type": mbkm_label,
            "Pembimbing": Pemb,
            "Alasan Unassigned": alasan,
            "Time Preference": time_pref_str,
        })
    
    df = pd.DataFrame(
        rows,
        columns=["NIM", "Nama", "Type", "Pembimbing", "Alasan Unassigned", "Time Preference"]
    )
    return df

# Generate dates for seminar scheduling
def generate_dates(start_date_str=None, num_days=H):
    if start_date_str:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
    else:
        today = datetime.now()
        days_ahead = 7 - today.weekday()  
        start_date = today + timedelta(days=days_ahead)
    
    dates = []
    current_date = start_date
    
    # Skip weekends when generating dates
    while len(dates) < num_days:
        if current_date.weekday() < 5: 
            dates.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "day_name": current_date.strftime("%A"),
                "formatted_date": current_date.strftime("%d %B %Y")
            })
        current_date += timedelta(days=1)
    
    return dates

# Generate seminar dates (weekdays only) using H (desired number of days)
seminar_dates = generate_dates(start_date_str=start_date_str, num_days=H)
# print("\nJadwal Seminar:")
# for i, date_info in enumerate(seminar_dates, 1):
#     print(f"Hari ke-{i}: {date_info['day_name']}, {date_info['formatted_date']}")

# Generate both dataframes
generated_schedule_df = schedule_to_dataframe(Schedule, timeslots, seminar_dates)
unassigned_df = unassigned_to_dataframe(unassigned)

# Create Excel writer object to write multiple sheets
output_path = "greedy_finalForm(2D).xlsx"
with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    # Write assigned students to first sheet
    generated_schedule_df.to_excel(writer, sheet_name='Jadwal', index=False)
    # Write unassigned students to second sheet
    unassigned_df.to_excel(writer, sheet_name='Tidak Terjadwal', index=False)
    # Write sorted students to third sheet
    sorted_students_df.to_excel(writer, sheet_name='Mahasiswa Terurut', index=False)

# print(f"Total mahasiswa tidak terjadwal: {len(unassigned)}")
# print(f"File tersimpan di: {output_path}")

objectives = compute_greedy_objectives(Schedule, timeslots, H, M)
total_obj = objectives["obj2_same_type_pairs"]+objectives["obj3_min_used_timeslots"]

# Calculate statistics for output
def calculate_statistics(schedule_df, unassigned_list, timeslots_list, M):
    """Calculate comprehensive statistics for scheduling result"""
    
    # Calculate unique slots and days used
    unique_slots = set()
    unique_days = set()
    for _, row in schedule_df.iterrows():
        if row['Hari'] != "-" and row['Slot'] != "-":
            unique_slots.add(f"{row['Hari']}-{row['Slot']}-{row['Ruangan']}")
            unique_days.add(row['Hari'])
    
    # Calculate lecturer statistics
    lecturer_stats = {}
    
    # Count assigned students per lecturer
    for _, row in schedule_df.iterrows():
        lecturer = row['Pembimbing']
        if lecturer and lecturer != "-":
            if lecturer not in lecturer_stats:
                lecturer_stats[lecturer] = {
                    'name': lecturer,
                    'assignedCount': 0,
                    'unassignedCount': 0,
                    'unassignedStudents': []
                }
            lecturer_stats[lecturer]['assignedCount'] += 1
    
    # Count unassigned students per lecturer
    for s in unassigned_list:
        lecturer = safe_get(s, ["PEMBIMBING"])
        if lecturer and lecturer != "-":
            if lecturer not in lecturer_stats:
                lecturer_stats[lecturer] = {
                    'name': lecturer,
                    'assignedCount': 0,
                    'unassignedCount': 0,
                    'unassignedStudents': []
                }
            lecturer_stats[lecturer]['unassignedCount'] += 1
            student_name = safe_get(s, ["NAMA", "Nama", "name"])
            lecturer_stats[lecturer]['unassignedStudents'].append(student_name)
    
    # Separate lecturers into complete and incomplete
    complete_lecturers = []
    incomplete_lecturers = []
    
    for lecturer_name, stats in lecturer_stats.items():
        if stats['unassignedCount'] == 0 and stats['assignedCount'] > 0:
            complete_lecturers.append(stats)
        elif stats['unassignedCount'] > 0:
            incomplete_lecturers.append(stats)
    
    # Count unique assigned students (exclude placeholder rows with NIM="-")
    unique_assigned_nims = set()
    for _, row in schedule_df.iterrows():
        nim = row.get('NIM')
        if nim and nim != "-" and not pd.isna(nim):
            unique_assigned_nims.add(nim)
    
    return {
        'slotsUsed': len(unique_slots),
        'daysUsed': len(unique_days),
        'studentsAssigned': len(unique_assigned_nims),  # Count unique NIMs only
        'studentsUnassigned': len(unassigned_list),
        'lecturersComplete': len(complete_lecturers),
        'lecturersIncomplete': len(incomplete_lecturers),
        'completeLecturers': complete_lecturers,
        'incompleteLecturers': incomplete_lecturers
    }

# Calculate statistics
statistics = calculate_statistics(generated_schedule_df, unassigned, timeslots, M)

rows = []
for i, timeslot in enumerate(timeslots):
    slot = timeslot['slot']  # 0-62
    room = timeslot['ruang']
    day_idx = slot // M  # Calculate day from slot (0-62)
    
    slot_info = result.get(i, {}) if isinstance(result, dict) else {}
    studs = slot_info.get("students", [])
    sups = slot_info.get("supervisors", [])

    # ambil ID dari objek mahasiswa (atau nilai langsung jika sudah angka)
    stud_ids = []
    for s in studs:
        if isinstance(s, dict):
            stud_ids.append(s.get("stuID", s))
        else:
            stud_ids.append(s)

    rows.append({
        "timeslot": f"Hari ke-{day_idx + 1}, Slot {slot % M + 1}, Room {room + 1}",
        "students": ", ".join(map(str, stud_ids)) if stud_ids else "-",
        "supervisors": ", ".join(map(str, sups)) if sups else "-",
    })

output = {
    "time": execution_time,
    "assigned": assigned_count,
    "unassigned": unassigned_count,
    "objective": total_obj,
    "objectives": objectives,  # Add detailed objectives including used_slots_count
    "statistics": statistics,
    "sorted_lecturers": sorted_lecturers,
    "table": generated_schedule_df.to_dict(orient="records"),
    "unassigned_table": unassigned_df.to_dict(orient="records"),
    "raw_schedule": rows
}
# print("==================================output=================")

# print(output)
class NaNSafeEncoder(json.JSONEncoder):
    def default(self, o):
        # set → list
        if isinstance(o, set):
            return list(o)
        # float NaN/inf
        if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            return None
        # pandas NaN
        if pd.isna(o):
            return None
        # numpy
        try:
            import numpy as np
            if isinstance(o, (np.integer,)):
                return int(o)
            if isinstance(o, (np.floating,)):
                return float(o) if not np.isnan(o) else None
        except Exception:
            pass
        # fallback
        return super().default(o)



print(json.dumps(output, cls=NaNSafeEncoder))
