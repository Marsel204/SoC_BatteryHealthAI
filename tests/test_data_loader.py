import os
import pytest
import numpy as np
from src.data_loader import NASADataLoader, AlignedCycle

def test_data_loader_initialization():
    data_dir = "data/raw"
    loader = NASADataLoader(data_dir=data_dir)
    assert loader.data_dir == data_dir
    assert loader.battery_ids == ["B0005", "B0006", "B0007", "B0018"]

def test_load_and_align_battery():
    loader = NASADataLoader(data_dir="data/raw")
    aligned = loader.load_and_align_battery("B0005", drop_cycle_1=True)
    assert len(aligned) > 0
    # B0005 has 168 discharge cycles; with cycle 1 dropped, expect 167
    assert len(aligned) == 167
    
    first_cycle = aligned[0]
    assert isinstance(first_cycle, AlignedCycle)
    assert first_cycle.battery_id == "B0005"
    assert first_cycle.cycle_index == 2  # Cycle 1 dropped, first is cycle 2
    assert first_cycle.capacity > 0
    assert first_cycle.soh > 0
    assert first_cycle.charge_data is not None
    assert first_cycle.discharge_data is not None
    assert first_cycle.re is not None
    assert first_cycle.rct is not None
    assert first_cycle.rest_time_hours >= 0.0

def test_time_parsing_and_rest_calculation():
    loader = NASADataLoader(data_dir="data/raw")
    t_vec = [2008, 4, 2, 13, 8, 17.921]
    dt = loader.parse_time_vector(t_vec)
    assert dt.year == 2008
    assert dt.month == 4
    assert dt.day == 2
    assert dt.hour == 13
    assert dt.minute == 8
