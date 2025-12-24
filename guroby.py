import gurobipy as gp
from gurobipy import GRB
import numpy as np
import pandas as pd
import argparse
import json
import time

# Parse command line arguments
parser = argparse.ArgumentParser()
parser.add_argument('limit', nargs='?', type=int, default=None, help='Limit number of students to process')
args = parser.parse_args()

try:
    # ============== LOAD DATA FROM FILES (same as greedy) ==============
    stu_df = pd.read_excel("uploads/stu.xlsx")
    
    # Limit students if specified
    if args.limit is not None:
        stu_df = stu_df.head(args.limit)
    
    # NIM -> stuID (index 0...)
    stu_df = stu_df.reset_index(drop=True)
    stu_df["stuID"] = stu_df.index
    
    # Pembimbing -> PB encoding
    stu_df_copy = stu_df.copy()  
    currPB = None
    pb_list = []
    for i, pembimbing in stu_df_copy["PEMBIMBING"].items():
        if pd.notna(pembimbing):
            currPB = pembimbing
        else:
            stu_df_copy.at[i, "PEMBIMBING"] = currPB
        pb_list.append(currPB)
    stu_df_copy["PB_raw"] = pb_list
    pb_map = {pb: idx for idx, pb in enumerate(pd.Series(pb_list).dropna().unique())}
    stu_df_copy["PB"] = stu_df_copy["PB_raw"].map(pb_map).fillna(0).astype(int)
    stu_df["PB"] = stu_df_copy["PB"].values
    stu_df["PEMBIMBING"] = stu_df_copy["PEMBIMBING"].values 
    
    # MBKM -> Type (mapping 0-5)
    mbkm_map = {"Magang": 0, "Stupen": 1, "Penelitian": 2, "Mengajar": 3, "KKN": 4, "Wirausaha": 5} 
    stu_df["Type"] = stu_df["MBKM"].map(mbkm_map).fillna(-1).astype(int)
    
    # Load time preferences
    pref_df = pd.read_csv("test-data/pref_22.csv", header=None)
    pembimbing_to_pb = stu_df.set_index('PEMBIMBING')['PB'].to_dict()
    pref_df['PB'] = pref_df[0].map(pembimbing_to_pb)
    pref_df = pref_df.sort_values('PB').reset_index(drop=True)
    pref_df = pref_df.drop(columns=[0, 'PB'])
    time_pref = pref_df.values.tolist()
    # print(time_pref)
    print("Data loaded successfully")
    print(f"Students: {len(stu_df)}")
    print(f"Supervisors: {len(time_pref)}")
    print(f"Time pref slots: {len(time_pref[0]) if time_pref else 0}")
    
    # ============== PARAMETERS (same as greedy) ==============
    C = 5  # max students per timeslot
    D = 3  # minimum supervisors per day
    H = 9  # number of days
    M = 7  # slots per day
    R = 3  # number of rooms
    limit_stu = 25
    
    # Objective weights
    ALPHA = 0.0  # time preference weight
    BETA = 1   # same type grouping weight
    GAMMA = 1  # minimize used timeslots weight
    
    # ============== DATA STRUCTURES ==============
    # Convert students dataframe to list of dicts
    students = stu_df.to_dict(orient="records")
    students = students[:limit_stu]
    
    # Generate timeslots (same as greedy)
    timeslots = []
    for slot in range(H * M):  # 0 to 62
        for r in range(R):     # 0, 1, 2
            timeslots.append({
                'slot': slot,    # global slot (0-62)
                'ruang': r
            })
    
    n = len(students)      # number of students
    m = len(timeslots)     # number of timeslots (189)
    d = len(time_pref)     # number of supervisors
    
    print(f"\nProblem size:")
    print(f"Students (n): {n}")
    print(f"Timeslots (m): {m}")
    print(f"Supervisors (d): {d}")
    print(f"Days (H): {H}")
    
    # ============== GUROBI MODEL ==============
    model = gp.Model("issp_adjusted")
    model.setParam('Threads', 10)
    
    # ============== DECISION VARIABLES ==============
    # x[i][j] = 1 if student j is assigned to timeslot i
    x = np.empty((m, n), dtype=object)
    for i in range(m):
        for j in range(n):
            x[i][j] = model.addVar(vtype=GRB.BINARY, name=f'x_{i}_{j}')
    
    # y[i][a] = 1 if supervisor a is assigned to timeslot i
    y = np.empty((m, d), dtype=object)
    for i in range(m):
        for a in range(d):
            y[i][a] = model.addVar(vtype=GRB.BINARY, name=f'y_{i}_{a}')
    
    # s[i] = 1 if timeslot i is used
    s = np.empty(m, dtype=object)
    for i in range(m):
        s[i] = model.addVar(vtype=GRB.BINARY, name=f's_{i}')
    
    # z[l] = 1 if day l is used
    z = np.empty(H, dtype=object)
    for l in range(H):
        z[l] = model.addVar(vtype=GRB.BINARY, name=f'z_{l}')
    
    print("Decision variables created")
    
    # ============== CONSTRAINTS ==============
    
    # 1. Each student must be assigned to exactly one timeslot
    for j in range(n):
        model.addConstr(
            sum(x[i][j] for i in range(m)) == 1,
            name=f'student_assignment_{j}'
        )
    
    # 2. Parallel session constraint: supervisor cannot be in two rooms at same time
    for a in range(d):
        for slot in range(H * M):  # for each global slot
            # Find all timeslots with this slot but different rooms
            timeslot_indices = [i for i in range(m) if timeslots[i]['slot'] == slot]
            if len(timeslot_indices) > 1:
                model.addConstr(
                    sum(y[i][a] for i in timeslot_indices) <= 1,
                    name=f'parallel_sup_{a}_slot_{slot}'
                )
    
    # 3. Student-supervisor-session relationship
    for a in range(d):
        for i in range(m):
            # If supervisor a is assigned, all their students must fit in capacity
            students_of_a = [j for j in range(n) if students[j]['PB'] == a]
            if students_of_a:
                model.addConstr(
                    sum(x[i][j] for j in students_of_a) <= C * y[i][a],
                    name=f'sup_capacity_{i}_{a}'
                )
                # If any student of supervisor a is assigned, supervisor must be present
                model.addConstr(
                    sum(x[i][j] for j in students_of_a) >= y[i][a],
                    name=f'sup_presence_{i}_{a}'
                )
    
    # 4. Timeslot capacity
    for i in range(m):
        model.addConstr(
            sum(x[i][j] for j in range(n)) <= C * s[i],
            name=f'timeslot_capacity_{i}'
        )
        model.addConstr(
            sum(x[i][j] for j in range(n)) >= 0,
            name=f'timeslot_min_{i}'
        )
    
    # 5. Day usage
    for l in range(H):
        # Timeslots belonging to day l
        day_timeslots = [i for i in range(m) if (timeslots[i]['slot'] // M) == l]
        if day_timeslots:
            model.addConstr(
                sum(s[i] for i in day_timeslots) <= len(day_timeslots) * z[l],
                name=f'day_usage_upper_{l}'
            )
            model.addConstr(
                sum(s[i] for i in day_timeslots) >= z[l],
                name=f'day_usage_lower_{l}'
            )
    
    # 6. Minimum number of supervisors per day (D supervisors)
    for l in range(H):
        day_timeslots = [i for i in range(m) if (timeslots[i]['slot'] // M) == l]
        if day_timeslots:
            totalD = gp.LinExpr()
            for i in day_timeslots:
                totalD += sum(y[i][a] for a in range(d))
            model.addConstr(
                totalD >= D * z[l],
                name=f'min_supervisors_day_{l}'
            )
    
    # 7. Time preference constraint
    for i in range(m):
        slot = timeslots[i]['slot']  # 0-62
        # Only assign supervisors who are available at this slot
        model.addConstr(
            sum(time_pref[a][slot] * y[i][a] for a in range(d)) == 
            sum(y[i][a] for a in range(d)),
            name=f'time_pref_{i}'
        )
    
    print("Constraints added")
    
    # ============== OBJECTIVE FUNCTION ==============
    
    # Objective 1: Time preference satisfaction
    theobjp = gp.LinExpr()
    for i in range(m):
        slot = timeslots[i]['slot']
        for j in range(n):
            pb = students[j]['PB']
            theobjp += time_pref[pb][slot] * x[i][j]
    
    # Objective 2: Group students of same type
    theobjq = gp.QuadExpr()
    for i in range(m):
        for j in range(n - 1):
            for k in range(j + 1, n):
                same_type = 1 if students[j]['Type'] == students[k]['Type'] else 0
                theobjq += same_type * x[i][j] * x[i][k]
    
    # Objective 3: Minimize number of used timeslots
    theobjm = gp.LinExpr()
    theobjm = m - sum(s[i] for i in range(m))

    # Combined objective
    model.setObjective(
        ALPHA * theobjp + BETA * theobjq + GAMMA * theobjm,
        GRB.MAXIMIZE
    )
    
    print("Objective function set")
    
    # ============== OPTIMIZE ==============
    print("\nOptimizing...")
    start_time = time.time()
    model.optimize()
    end_time = time.time()
    execution_time = end_time - start_time
    
    # ============== DISPLAY RESULTS ==============
    if model.status == GRB.OPTIMAL:
        print(f'\nOptimal objective: {model.objVal}')
        
        # Count active days and timeslots
        active_days = sum(1 for l in range(H) if z[l].X > 0.5)
        active_timeslots = sum(1 for i in range(m) if s[i].X > 0.5)
        
        # Count assigned and unassigned students
        assigned_students = sum(1 for j in range(n) for i in range(m) if x[i][j].X > 0.5)
        unassigned_students = n - assigned_students
        
        print(f'Active days: {active_days}')
        print(f'Active timeslots: {active_timeslots}')
        print(f'Assigned students: {assigned_students}')
        print(f'Unassigned students: {unassigned_students}')
        print(f'Execution time: {execution_time:.4f} seconds')
        # ===================================================================================================detail
        
        # ============== CALCULATE OBJECTIVE COMPONENTS ==============
        print("\n" + "="*80)
        print("OBJECTIVE FUNCTION BREAKDOWN")
        print("="*80)
        
        # Calculate theobjp (time preference satisfaction)
        objp_value = 0
        for i in range(m):
            slot = timeslots[i]['slot']
            for j in range(n):
                if x[i][j].X > 0.5:
                    pb = students[j]['PB']
                    objp_value += time_pref[pb][slot]
        
        print(f"\n1. Time Preference Satisfaction (theobjp):")
        print(f"   Value: {objp_value}")
        print(f"   Weight (ALPHA): {ALPHA}")
        print(f"   Weighted contribution: {ALPHA * objp_value}")
        
        # Calculate theobjq (same type grouping)
        objq_value = 0
        same_type_pairs = []
        for i in range(m):
            students_in_slot = [j for j in range(n) if x[i][j].X > 0.5]
            if len(students_in_slot) > 1:
                for idx1 in range(len(students_in_slot)):
                    for idx2 in range(idx1 + 1, len(students_in_slot)):
                        j = students_in_slot[idx1]
                        k = students_in_slot[idx2]
                        if students[j]['Type'] == students[k]['Type']:
                            objq_value += 1
                            same_type_pairs.append({
                                'timeslot': i,
                                'slot': timeslots[i]['slot'],
                                'room': timeslots[i]['ruang'],
                                'student1': j,
                                'student2': k,
                                'type': students[j]['Type']
                            })
        
        print(f"\n2. Same Type Grouping (theobjq):")
        print(f"   Total same-type pairs: {objq_value}")
        print(f"   Weight (BETA): {BETA}")
        print(f"   Weighted contribution: {BETA * objq_value}")
        
        if same_type_pairs:
            print(f"   Details of same-type pairs:")
            type_names = {0: "Magang", 1: "Stupen", 2: "Penelitian", 3: "Mengajar", 4: "KKN", 5: "Wirausaha"}
            for pair in same_type_pairs[:10]:  # Show first 10 pairs
                day = pair['slot'] // M + 1
                slot_in_day = pair['slot'] % M + 1
                room = pair['room'] + 1
                type_name = type_names.get(pair['type'], f"Type {pair['type']}")
                print(f"     - Day {day}, Slot {slot_in_day}, Room {room}: Student {pair['student1']} & {pair['student2']} ({type_name})")
            if len(same_type_pairs) > 10:
                print(f"     ... and {len(same_type_pairs) - 10} more pairs")
        
        # Calculate theobjm (minimize used timeslots)
        used_timeslots_count = sum(1 for i in range(m) if s[i].X > 0.5)
        objm_value = m - used_timeslots_count
        
        print(f"\n3. Minimize Used Timeslots (theobjm):")
        print(f"   Total timeslots available: {m}")
        print(f"   Timeslots used: {used_timeslots_count}")
        print(f"   Timeslots NOT used: {objm_value}")
        print(f"   Weight (GAMMA): {GAMMA}")
        print(f"   Weighted contribution: {GAMMA * objm_value}")
        
        # Show which slots are used
        print(f"\n   Used timeslots distribution:")
        for l in range(H):
            day_timeslots = [i for i in range(m) if (timeslots[i]['slot'] // M) == l]
            used_in_day = sum(1 for i in day_timeslots if s[i].X > 0.5)
            if used_in_day > 0:
                print(f"     Day {l + 1}: {used_in_day}/{len(day_timeslots)} timeslots used")
        
        # Total objective
        total_objective = ALPHA * objp_value + BETA * objq_value + GAMMA * objm_value
        print(f"\n" + "-"*80)
        print(f"TOTAL OBJECTIVE VALUE: {total_objective}")
        print(f"  = ({ALPHA} * {objp_value}) + ({BETA} * {objq_value}) + ({GAMMA} * {objm_value})")
        print(f"  = {ALPHA * objp_value} + {BETA * objq_value} + {GAMMA * objm_value}")
        print(f"  = {total_objective}")
        print(f"\nGurobi reported objective: {model.objVal}")
        print(f"Difference (should be ~0): {abs(total_objective - model.objVal)}")
        print("="*80)
        # ===================================================================================================
        # Display schedule
        print("\n" + "="*80)
        print("SCHEDULE")
        print("="*80)
        
        for l in range(H):
            if z[l].X > 0.5:
                print(f"\n>>> DAY {l + 1}")
                day_timeslots = [i for i in range(m) if (timeslots[i]['slot'] // M) == l]
                
                for i in day_timeslots:
                    if s[i].X > 0.5:
                        slot = timeslots[i]['slot']
                        room = timeslots[i]['ruang']
                        slot_in_day = slot % M
                        
                        print(f"\n  Slot {slot_in_day}, Room {room + 1}:")
                        
                        # Supervisors
                        active_sups = [a for a in range(d) if y[i][a].X > 0.5]
                        print(f"    Supervisors: {active_sups}")
                        
                        # Students
                        assigned_students = [j for j in range(n) if x[i][j].X > 0.5]
                        for j in assigned_students:
                            print(f"      Student {j}: Type={students[j]['Type']}, PB={students[j]['PB']}")
        
        print("\n" + "="*80)
        
    else:
        print(f'Optimization ended with status {model.status}')
        if model.status == GRB.INFEASIBLE:
            print("Model is infeasible. Computing IIS...")
            model.computeIIS()
            model.write("model.ilp")
            print("IIS written to model.ilp")

except gp.GurobiError as e:
    print(f"Gurobi Error {e.errno}: {e}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

# Output JSON for API (at the very end)
if 'model' in locals() and hasattr(model, 'status') and model.status == GRB.OPTIMAL:
    # Count assigned and unassigned studentsun
    assigned_students = sum(1 for j in range(n) for i in range(m) if x[i][j].X > 0.5)
    unassigned_students = n - assigned_students
    
    result = {
        "algorithm": "gurobi",
        "time": execution_time if 'execution_time' in locals() else 0,
        "assigned": assigned_students,
        "unassigned": unassigned_students,
        "objective": model.objVal
    }
    print(json.dumps(result))
elif 'model' in locals() and hasattr(model, 'status') and model.status == GRB.INFEASIBLE:
    result = {
        "algorithm": "gurobi",
        "time": execution_time if 'execution_time' in locals() else 0,
        "assigned": 0,
        "unassigned": n if 'n' in locals() else 0,
        "objective": 0,
        "error": "infeasible"
    }
    print(json.dumps(result))
else:
    result = {
        "algorithm": "gurobi",
        "time": 0,
        "assigned": 0,
        "unassigned": n if 'n' in locals() else 0,
        "objective": 0,
        "error": "unknown"
    }
    print(json.dumps(result))