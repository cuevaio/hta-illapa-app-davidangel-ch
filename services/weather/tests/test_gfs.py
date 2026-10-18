import datetime as dt

import pytest

from weather_service import gfs

IDX = """\
580:411702313:d=2026101712:ICETK:surface:3 hour fcst:
581:411790363:d=2026101712:TMP:2 m above ground:3 hour fcst:
582:412300492:d=2026101712:SPFH:2 m above ground:3 hour fcst:
593:420244607:d=2026101712:PRATE:surface:3 hour fcst:
595:421660507:d=2026101712:PRATE:surface:0-3 hour ave fcst:
596.1:422269380:d=2026101712:UGRD:planetary boundary layer:3 hour fcst:
596.2:422269380:d=2026101712:VGRD:planetary boundary layer:3 hour fcst:
597:422582016:d=2026101712:CAPE:surface:3 hour fcst:
"""


def test_parse_idx_byte_ranges():
    entries = gfs.parse_idx(IDX)
    tmp = gfs.find_entry(entries, gfs.FieldSpec("TMP", "2 m above ground"))
    assert (tmp.offset, tmp.end) == (411790363, 412300491)
    assert tmp.range_header == "bytes=411790363-412300491"
    assert tmp.date == "2026101712"
    assert tmp.forecast == "3 hour fcst"


def test_last_message_reads_to_end_of_file():
    last = gfs.parse_idx(IDX)[-1]
    assert last.variable == "CAPE" and last.end is None
    assert last.range_header == "bytes=422582016-"


def test_sub_messages_share_the_parent_range():
    entries = gfs.parse_idx(IDX)
    u, v = (e for e in entries if e.number.startswith("596"))
    assert u.offset == v.offset and u.end == v.end == 422582015


def test_forecast_regex_selects_average_vs_instantaneous():
    entries = gfs.parse_idx(IDX)
    inst = gfs.find_entry(entries, gfs.FieldSpec("PRATE", "surface", r"^\d+ hour fcst$"))
    ave = gfs.find_entry(entries, gfs.FieldSpec("PRATE", "surface", r"ave fcst"))
    assert inst.offset == 420244607 and ave.offset == 421660507


def test_missing_field_raises():
    with pytest.raises(LookupError):
        gfs.find_entry(gfs.parse_idx(IDX), gfs.FieldSpec("TMP", "surface"))


def test_malformed_idx_raises():
    with pytest.raises(ValueError):
        gfs.parse_idx("1:2:3\n")


def test_candidate_cycles_floor_to_six_hours():
    now = dt.datetime(2026, 10, 17, 3, 59, tzinfo=dt.timezone.utc)
    cycles = gfs.candidate_cycles(now, 3)
    assert [gfs.cycle_token(c) for c in cycles] == ["2026101700", "2026101618", "2026101612"]


def test_urls():
    c = dt.datetime(2026, 10, 17, 6, tzinfo=dt.timezone.utc)
    assert gfs.grib_url(c, 3) == "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261017/06/atmos/gfs.t06z.pgrb2.0p25.f003"
    assert gfs.idx_url(c, 48).endswith("gfs.t06z.pgrb2.0p25.f048.idx")


def test_parse_fhours():
    assert gfs.parse_fhours("0-12:3") == [0, 3, 6, 9, 12]
    assert gfs.parse_fhours("0,6, 3") == [0, 3, 6]
    assert gfs.parse_fhours("0-6:3,24") == [0, 3, 6, 24]
    for bad in ("", "x", "6-0", "0-6:0", "0-400"):
        with pytest.raises(ValueError):
            gfs.parse_fhours(bad)


def test_field_key_is_filename_safe():
    assert gfs.FieldSpec("TMP", "2 m above ground").key == "tmp_2_m_above_ground"
